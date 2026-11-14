use crate::{sink::Sink, store};
use carbon_proto::{SecretField, SecretRequest, SecretTarget};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::{LazyLock, Mutex},
    time::Duration,
};
use tokio::{
    io::{AsyncRead, AsyncReadExt},
    process::Command,
};
use zeroize::Zeroize;

const TTL: i64 = 10 * 60 * 1000;
const OUTPUT_LIMIT: u64 = 128 * 1024;
const RUN_LIMIT: Duration = Duration::from_secs(300);
static REQUESTS: LazyLock<Mutex<HashMap<String, Handoff>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Handoff {
    pub id: String,
    pub session_id: String,
    pub agent: String,
    pub purpose: String,
    pub fields: Vec<SecretField>,
    pub target: SecretTarget,
    pub cwd: String,
    pub expires_at: i64,
    pub state: String,
    pub message: Option<String>,
    pub output: Option<String>,
    pub exit_code: Option<i32>,
    pub keep_file: bool,
    pub keep_blocked: Option<String>,
    pub submit_label: Option<String>,
    #[serde(skip)]
    browser: Option<Value>,
    #[serde(skip)]
    temp_path: PathBuf,
}

struct Values(HashMap<String, String>);
impl Drop for Values {
    fn drop(&mut self) {
        for value in self.0.values_mut() {
            value.zeroize();
        }
    }
}

fn now() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

/// Reconnects carry only metadata; no secret value ever enters this store.
pub fn snapshot() -> Vec<Handoff> {
    REQUESTS.lock().unwrap().values().cloned().collect()
}

pub fn for_session(session: &str) -> Vec<Handoff> {
    let mut requests: Vec<_> = snapshot()
        .into_iter()
        .filter(|r| r.session_id == session)
        .collect();
    requests.sort_by_key(|r| r.expires_at);
    requests
}

/// A restarted server has no live hand-offs, so crash leftovers cannot be reused.
pub async fn clean_stale() -> Result<(), String> {
    let root = store::get_home_app_dir()
        .await
        .map_err(|_| "Could not locate private hand-offs.")?
        .join("secret-handoffs");
    if root.exists() {
        std::fs::remove_dir_all(&root)
            .map_err(|_| "Could not remove temporary hand-offs left by the previous server.")?;
    }
    Ok(())
}

fn changed(session: &str, sink: &Sink) {
    sink.emit(
        "secret_requests_changed",
        json!({ "sessionId": session, "requests": for_session(session) }),
    )
    .ok();
}

fn get(session: &str, id: &str) -> Result<Handoff, String> {
    REQUESTS
        .lock()
        .unwrap()
        .get(id)
        .filter(|r| r.session_id == session)
        .cloned()
        .ok_or("This hand-off is unavailable. Ask for a new one.".into())
}

fn finish(session: &str, id: &str, state: &str, message: Option<String>, sink: &Sink) {
    if let Some(r) = REQUESTS
        .lock()
        .unwrap()
        .get_mut(id)
        .filter(|r| r.session_id == session)
    {
        r.state = state.into();
        r.message = message;
        r.browser = None;
    }
    changed(session, sink);
}

/// The agent can request, inspect or withdraw metadata, but never submit a value.
pub async fn request(request: SecretRequest, sink: &Sink) -> Result<Value, String> {
    match request {
        SecretRequest::Status { session_id, id } => serde_json::to_value(get(&session_id, &id)?)
            .map_err(|_| "Could not read hand-off.".into()),
        SecretRequest::Cancel { session_id, id } => {
            decide(&session_id, &id, "cancelled", sink)?;
            Ok(json!({ "id": id, "state": "cancelled" }))
        }
        SecretRequest::Create {
            session_id,
            purpose,
            fields,
            mut target,
        } => {
            validate(&purpose, &fields, &target)?;
            let session = store::get_session_index_item(&session_id)
                .await
                .map_err(|_| "Could not read session.")?
                .filter(|s| !s.archived)
                .ok_or("This session is unavailable.")?;
            let cwd = std::fs::canonicalize(&session.cwd)
                .map_err(|_| "The session's working directory is unavailable.")?;
            if let SecretTarget::File { path, .. } = &mut target {
                *path = keep_path(&cwd, path)?.to_string_lossy().into_owned();
            }
            let keep_blocked = if let SecretTarget::File { path, command } = &target {
                let reason = kept_file_problem(&cwd, Path::new(path)).await;
                if command.is_empty() {
                    if let Some(reason) = &reason {
                        return Err(reason.clone());
                    }
                }
                reason
            } else {
                None
            };
            let browser = if matches!(target, SecretTarget::Browser { .. }) {
                Some(
                    browser_call(
                        json!({ "sessionId": session_id, "target": target, "action": "prepare" }),
                    )
                    .await?,
                )
            } else {
                None
            };
            let id = uuid::Uuid::new_v4().to_string();
            let temp_path = store::get_home_app_dir()
                .await
                .map_err(|_| "Could not prepare a private hand-off.")?
                .join("secret-handoffs")
                .join(&id)
                .join("secrets.env");
            let r = Handoff {
                id: id.clone(),
                session_id: session_id.clone(),
                agent: session.harness.label().into(),
                purpose,
                fields,
                target,
                cwd: cwd.to_string_lossy().into_owned(),
                expires_at: now() + TTL,
                state: "pending".into(),
                message: None,
                output: None,
                exit_code: None,
                keep_file: false,
                keep_blocked,
                submit_label: browser
                    .as_ref()
                    .and_then(|b| b["label"].as_str())
                    .map(str::to_owned),
                browser,
                temp_path,
            };
            {
                let mut requests = REQUESTS.lock().unwrap();
                if requests
                    .values()
                    .filter(|r| {
                        r.session_id == session_id
                            && matches!(r.state.as_str(), "pending" | "running")
                    })
                    .count()
                    >= 4
                {
                    return Err("This session already has four open secret requests.".into());
                }
                requests
                    .retain(|_, r| now() - r.expires_at < 60 * 60 * 1000 || r.state == "running");
                requests.insert(id.clone(), r.clone());
            }
            changed(&session_id, sink);
            let sink = sink.clone();
            tokio::spawn(async move {
                tokio::time::sleep(Duration::from_millis(TTL as u64)).await;
                let _ = decide(&session_id, &id, "expired", &sink);
            });
            serde_json::to_value(r).map_err(|_| "Could not format hand-off.".into())
        }
    }
}

fn validate(purpose: &str, fields: &[SecretField], target: &SecretTarget) -> Result<(), String> {
    if purpose.trim().is_empty() || purpose.len() > 2000 || fields.is_empty() || fields.len() > 16 {
        return Err("Give a purpose and between one and sixteen named secret fields.".into());
    }
    let mut names = HashSet::new();
    for field in fields {
        if !env_name(&field.name)
            || field.name.len() > 128
            || field.label.trim().is_empty()
            || field.label.len() > 200
            || !names.insert(&field.name)
        {
            return Err("Secret fields need unique variable names and short labels.".into());
        }
    }
    let command = match target {
        SecretTarget::Command { command } if command.is_empty() => {
            return Err("Specify the command to approve.".into())
        }
        SecretTarget::Command { command } | SecretTarget::File { command, .. } => Some(command),
        SecretTarget::Browser {
            origin,
            fields: selectors,
            submit,
        } => {
            let url = reqwest::Url::parse(origin).map_err(|_| "Use an exact HTTPS origin.")?;
            if url.scheme() != "https"
                || url.origin().ascii_serialization() != *origin
                || !url.username().is_empty()
                || url.password().is_some()
            {
                return Err("Use an exact HTTPS origin without a path or credentials.".into());
            }
            let selected: HashSet<_> = selectors.iter().map(|f| &f.name).collect();
            if selected != names
                || selected.len() != selectors.len()
                || selectors
                    .iter()
                    .any(|f| f.selector.is_empty() || f.selector.len() > 1000)
                || submit.is_empty()
                || submit.len() > 1000
            {
                return Err(
                    "Specify exactly one selector per secret field and a submit button.".into(),
                );
            }
            None
        }
    };
    if command.is_some_and(|c| {
        c.iter().any(|s| s.contains('\0')) || c.iter().map(String::len).sum::<usize>() > 32 * 1024
    }) {
        return Err("The approved command is too long or contains a null byte.".into());
    }
    Ok(())
}

fn env_name(name: &str) -> bool {
    let mut chars = name.chars();
    matches!(chars.next(), Some(c) if c == '_' || c.is_ascii_alphabetic())
        && chars.all(|c| c == '_' || c.is_ascii_alphanumeric())
}

/// Canonical parents keep a symlink from moving an approved file outside the checkout.
fn keep_path(cwd: &Path, given: &str) -> Result<PathBuf, String> {
    let path = cwd.join(given);
    let parent = path
        .parent()
        .and_then(|p| p.canonicalize().ok())
        .ok_or("The file's parent directory must already exist.")?;
    let name = path
        .file_name()
        .filter(|n| !n.is_empty())
        .ok_or("Choose a file inside the session checkout.")?;
    let path = parent.join(name);
    if !parent.starts_with(cwd)
        || std::fs::symlink_metadata(&path)
            .is_ok_and(|m| !m.is_file() || m.file_type().is_symlink())
    {
        return Err("Choose a regular file inside the session checkout, without a symlink.".into());
    }
    Ok(path)
}

async fn kept_file_problem(cwd: &Path, path: &Path) -> Option<String> {
    if path.exists() {
        return Some(
            "This file already exists. Choose a new path; Carbon won't replace it.".into(),
        );
    }
    let ignored = Command::new("git")
        .arg("check-ignore")
        .arg("--quiet")
        .arg("--")
        .arg(path)
        .current_dir(cwd)
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .await
        .is_ok_and(|s| s.success());
    (!ignored).then(|| "This path isn't ignored by git. Ask the agent to ignore it or choose another path before keeping a secret.".into())
}

fn decide(session: &str, id: &str, state: &str, sink: &Sink) -> Result<(), String> {
    {
        let mut requests = REQUESTS.lock().unwrap();
        let r = requests
            .get_mut(id)
            .filter(|r| r.session_id == session)
            .ok_or("This hand-off is unavailable.")?;
        if r.state != "pending" {
            return Err("This hand-off has already been answered.".into());
        }
        r.state = state.into();
        r.browser = None;
    }
    changed(session, sink);
    Ok(())
}

pub fn deny(session: &str, id: &str, sink: &Sink) -> Result<(), String> {
    decide(session, id, "denied", sink)
}

/// Claiming the pending entry under one lock makes duplicate submissions harmless.
pub async fn answer(
    session: &str,
    id: &str,
    values: HashMap<String, String>,
    keep_file: bool,
    sink: &Sink,
) -> Result<(), String> {
    let values = Values(values);
    let r = claim(session, id, &values, keep_file)?;
    changed(session, sink);
    let sink = sink.clone();
    tokio::spawn(async move {
        let outcome = execute(&r, &values).await;
        drop(values);
        match outcome {
            Ok((output, code)) => {
                if let Some(entry) = REQUESTS.lock().unwrap().get_mut(&r.id) {
                    entry.output = output;
                    entry.exit_code = code;
                }
                let state = if code.is_some_and(|c| c != 0) {
                    "failed"
                } else {
                    "used"
                };
                let message = (state == "failed").then(|| if r.keep_file {
                    "The approved command exited unsuccessfully. The approved file was kept. Ask for a new hand-off to retry.".into()
                } else { "The approved command exited unsuccessfully. Ask for a new hand-off to retry.".into() });
                finish(&r.session_id, &r.id, state, message, &sink);
            }
            Err(message) => finish(&r.session_id, &r.id, "failed", Some(message), &sink),
        }
    });
    Ok(())
}

fn claim(session: &str, id: &str, values: &Values, keep_file: bool) -> Result<Handoff, String> {
    let mut requests = REQUESTS.lock().unwrap();
    let r = requests
        .get_mut(id)
        .filter(|r| r.session_id == session)
        .ok_or("This hand-off is unavailable.")?;
    if r.state != "pending" {
        return Err("This hand-off has already been answered.".into());
    }
    if now() >= r.expires_at {
        return Err("This hand-off expired. Ask for a new one.".into());
    }
    let expected: HashSet<_> = r.fields.iter().map(|f| &f.name).collect();
    if values.0.keys().collect::<HashSet<_>>() != expected
        || values
            .0
            .values()
            .any(|v| v.is_empty() || v.len() > 64 * 1024 || v.contains('\0'))
    {
        return Err("Fill every requested field with a value under 64 KiB.".into());
    }
    match &r.target {
        SecretTarget::File { command, .. } if command.is_empty() && !keep_file => {
            return Err(
                "Choose Keep in this file, or ask for a command to use a temporary file.".into(),
            )
        }
        SecretTarget::File { .. } => {}
        _ if keep_file => return Err("Only a file hand-off can keep a secret.".into()),
        _ => {}
    }
    r.state = "running".into();
    r.keep_file = keep_file;
    Ok(r.clone())
}

async fn execute(r: &Handoff, values: &Values) -> Result<(Option<String>, Option<i32>), String> {
    let current = store::get_session_index_item(&r.session_id)
        .await
        .map_err(|_| "Could not check session.")?
        .filter(|s| !s.archived)
        .ok_or("The session is no longer available.")?;
    if std::fs::canonicalize(&current.cwd).ok() != Some(PathBuf::from(&r.cwd)) {
        return Err("The working directory changed. Ask for a new hand-off.".into());
    }
    match &r.target {
        SecretTarget::Command { command } => run(command, &r.cwd, &values.0, None).await,
        SecretTarget::File { path, command } => {
            let body = env_file(&values.0)?;
            let file = if r.keep_file {
                let checked = keep_path(Path::new(&r.cwd), path)?;
                if checked != PathBuf::from(path) {
                    return Err("The file destination changed. Ask for a new hand-off.".into());
                }
                if let Some(problem) = kept_file_problem(Path::new(&r.cwd), &checked).await {
                    return Err(problem);
                }
                // Refuse replacement: an existing .env may hold unrelated secrets or concurrent edits.
                private_file(&checked, body.as_bytes())?;
                checked
            } else {
                private_dir(r.temp_path.parent().unwrap())?;
                private_file(&r.temp_path, body.as_bytes())?;
                r.temp_path.clone()
            };
            drop(body);
            let mut cleanup = TempFile((!r.keep_file).then_some(file.clone()));
            let result = if command.is_empty() {
                Ok((None, None))
            } else {
                run(command, &r.cwd, &HashMap::new(), Some(&file)).await
            };
            cleanup.remove()?;
            result.map(|(output, code)| (output.map(|o| redact(&o, &values.0)), code))
        }
        SecretTarget::Browser { .. } => {
            browser_call(json!({ "sessionId": r.session_id, "target": r.target, "action": "submit", "prepared": r.browser, "values": values.0 })).await?;
            Ok((None, None))
        }
    }
}

/// Dotenv quotes are literal delimiters, not JSON escapes; some values have no lossless spelling.
fn env_file(values: &HashMap<String, String>) -> Result<zeroize::Zeroizing<String>, String> {
    let mut fields: Vec<_> = values.iter().collect();
    fields.sort_by_key(|(name, _)| *name);
    let mut body = zeroize::Zeroizing::new(String::new());
    for (name, value) in fields {
        if value.contains('\r') {
            return Err("Dotenv readers change carriage returns. Use a command environment hand-off for this value.".into());
        }
        let quote = ['\'', '`', '"'].into_iter().find(|quote| {
            !value.contains(*quote)
                && (*quote != '"' || (!value.contains("\\n") && !value.contains("\\r")))
        });
        let unquoted = !value.contains(['#', '\n'])
            && value.trim() == value
            && !value.starts_with(['\'', '"', '`']);
        if quote.is_none() && !unquoted {
            return Err("This value cannot be written losslessly as dotenv. Use a command environment hand-off instead.".into());
        }
        body.push_str(name);
        body.push('=');
        if let Some(quote) = quote {
            body.push(quote);
        }
        body.push_str(value);
        if let Some(quote) = quote {
            body.push(quote);
        }
        body.push('\n');
    }
    Ok(body)
}

fn private_dir(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::DirBuilderExt;
    std::fs::DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(path)
        .map_err(|_| "Could not create a private temporary directory.".into())
}

fn private_file(path: &Path, bytes: &[u8]) -> Result<(), String> {
    use std::{io::Write, os::unix::fs::OpenOptionsExt};
    let mut file = std::fs::OpenOptions::new().write(true).create_new(true).mode(0o600).open(path)
        .map_err(|_| "The file already exists or cannot be created. Choose a new path and request a new hand-off.")?;
    if file.write_all(bytes).and_then(|_| file.sync_all()).is_err() {
        let _ = std::fs::remove_file(path);
        return Err("Could not write the secret file.".into());
    }
    Ok(())
}

struct TempFile(Option<PathBuf>);
impl TempFile {
    fn remove(&mut self) -> Result<(), String> {
        if let Some(path) = &self.0 {
            match std::fs::remove_file(path) {
                Ok(()) => {},
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {},
                Err(_) => return Err("The temporary secret file could not be removed. Delete it from Carbon's secret-handoffs directory.".into()),
            }
            let _ = std::fs::remove_dir(path.parent().unwrap());
        }
        self.0 = None;
        Ok(())
    }
}
impl Drop for TempFile {
    fn drop(&mut self) {
        let _ = self.remove();
    }
}

struct ProcessGroup(i32);
impl Drop for ProcessGroup {
    fn drop(&mut self) {
        if self.0 > 0 {
            unsafe {
                libc::kill(-self.0, libc::SIGKILL);
            }
        }
    }
}

async fn read_output(reader: impl AsyncRead + Unpin) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    reader
        .take(OUTPUT_LIMIT + 1)
        .read_to_end(&mut bytes)
        .await
        .map_err(|_| "Could not read command output.")?;
    if bytes.len() as u64 > OUTPUT_LIMIT {
        return Err("The command exceeded the hand-off output limit.".into());
    }
    Ok(bytes)
}

/// Values go through env, never argv, and output is redacted before it reaches any store or event.
async fn run(
    command: &[String],
    cwd: &str,
    values: &HashMap<String, String>,
    file: Option<&Path>,
) -> Result<(Option<String>, Option<i32>), String> {
    use std::process::Stdio;
    let args: Vec<_> = command
        .iter()
        .skip(1)
        .map(|arg| match file {
            Some(path) => arg.replace("{secret_file}", &path.to_string_lossy()),
            None => arg.clone(),
        })
        .collect();
    let mut cmd = Command::new(&command[0]);
    cmd.args(&args)
        .current_dir(cwd)
        .env(
            "PATH",
            crate::binpath::child_path(crate::binpath::resolved_bin_dirs()),
        )
        .envs(values)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .process_group(0);
    if let Some(path) = file {
        cmd.env("CARBON_SECRET_FILE", path);
    }
    let mut child = cmd
        .spawn()
        .map_err(|_| "Could not start the approved command.")?;
    let _group = ProcessGroup(child.id().unwrap_or_default() as i32);
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let result = tokio::time::timeout(RUN_LIMIT, async {
        tokio::try_join!(
            async {
                child
                    .wait()
                    .await
                    .map_err(|_| "Could not wait for the approved command.".to_string())
            },
            read_output(stdout),
            read_output(stderr)
        )
    })
    .await
    .map_err(|_| "The approved command timed out. Its process group was stopped.")??;
    let output = format!(
        "{}{}",
        String::from_utf8_lossy(&result.1),
        String::from_utf8_lossy(&result.2)
    );
    Ok((
        Some(redact(&output, values)),
        Some(result.0.code().unwrap_or(-1)),
    ))
}

fn redact(output: &str, values: &HashMap<String, String>) -> String {
    let mut secrets: Vec<String> = values
        .values()
        .filter(|v| !v.is_empty())
        .flat_map(|value| {
            let escaped = serde_json::to_string(value).unwrap();
            [value.clone(), escaped[1..escaped.len() - 1].to_string()]
        })
        .collect();
    secrets.sort_by_key(|v| std::cmp::Reverse(v.len()));
    secrets
        .into_iter()
        .fold(output.into(), |text: String, secret| {
            text.replace(&secret, "[redacted]")
        })
}

async fn browser_call(args: Value) -> Result<Value, String> {
    tokio::time::timeout(Duration::from_secs(45), browser_call_inner(args)).await
        .map_err(|_| "The browser did not confirm the hand-off. It may already have submitted; check the page before requesting another.".to_string())?
}

async fn browser_call_inner(args: Value) -> Result<Value, String> {
    #[cfg(feature = "desktop")]
    if crate::is_server() && crate::serve::host_browser() {
        return crate::serve::host_call("secret_browser", args)
            .await
            .ok_or("The browser disconnected. Ask for a new hand-off.")?
            .map_err(|_| "The browser hand-off failed. Ask for a new hand-off.".into());
    }
    answer_browser(args).await
}

/// Host calls carry values directly to Chromium without an agent tool call or transcript event.
pub async fn answer_browser(args: Value) -> Result<Value, String> {
    #[cfg(all(feature = "cef", target_os = "macos"))]
    if !crate::is_server() {
        return crate::cef::automation::secret_handoff(args).await;
    }
    #[cfg(any(feature = "serve", feature = "desktop"))]
    {
        crate::headless::automation::secret_handoff(args).await
    }
    #[cfg(not(any(feature = "serve", feature = "desktop")))]
    {
        let _ = args;
        Err("This build has no browser.".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    fn handoff() -> Handoff {
        Handoff {
            id: uuid::Uuid::new_v4().to_string(),
            session_id: "secret-test-session".into(),
            agent: "Test".into(),
            purpose: "Use a synthetic token".into(),
            fields: vec![SecretField {
                name: "TOKEN".into(),
                label: "Token".into(),
            }],
            target: SecretTarget::Command {
                command: vec!["/usr/bin/true".into()],
            },
            cwd: "/tmp".into(),
            expires_at: now() + TTL,
            state: "pending".into(),
            message: None,
            output: None,
            exit_code: None,
            keep_file: false,
            keep_blocked: None,
            submit_label: None,
            browser: None,
            temp_path: PathBuf::new(),
        }
    }

    #[test]
    fn dotenv_encoding_matches_the_actual_parser_fixtures() {
        let cases: Vec<Value> =
            serde_json::from_str(include_str!("../fixtures/secret_env.json")).unwrap();
        for case in cases {
            let values = HashMap::from([("TOKEN".into(), case["value"].as_str().unwrap().into())]);
            match case["encoded"].as_str() {
                Some(expected) => assert_eq!(env_file(&values).unwrap().as_str(), expected),
                None => assert!(env_file(&values).is_err()),
            }
        }
    }

    #[test]
    fn submission_is_session_bound_single_use_and_never_stores_values() {
        let r = handoff();
        REQUESTS.lock().unwrap().insert(r.id.clone(), r.clone());
        let values = Values(HashMap::from([(
            "TOKEN".into(),
            "synthetic-private-token".into(),
        )]));
        assert!(claim("other-session", &r.id, &values, false).is_err());
        assert!(claim(&r.session_id, &r.id, &Values(HashMap::new()), false).is_err());
        assert_eq!(
            claim(&r.session_id, &r.id, &values, false).unwrap().state,
            "running"
        );
        assert!(claim(&r.session_id, &r.id, &values, false).is_err());
        assert!(!serde_json::to_string(&get(&r.session_id, &r.id).unwrap())
            .unwrap()
            .contains("synthetic-private-token"));
        REQUESTS.lock().unwrap().remove(&r.id);
    }

    #[test]
    fn expired_denied_and_cancelled_requests_cannot_be_claimed() {
        let sink = Sink::new(|_, _| {});
        let values = Values(HashMap::from([("TOKEN".into(), "synthetic-token".into())]));
        for state in ["expired", "denied", "cancelled"] {
            let mut r = handoff();
            if state == "expired" {
                r.expires_at = now() - 1;
            }
            REQUESTS.lock().unwrap().insert(r.id.clone(), r.clone());
            if state != "expired" {
                decide(&r.session_id, &r.id, state, &sink).unwrap();
            }
            assert!(claim(&r.session_id, &r.id, &values, false).is_err());
            REQUESTS.lock().unwrap().remove(&r.id);
        }
    }

    #[test]
    fn file_only_requests_require_explicit_keep() {
        let mut r = handoff();
        r.target = SecretTarget::File {
            path: "/tmp/test.env".into(),
            command: vec![],
        };
        REQUESTS.lock().unwrap().insert(r.id.clone(), r.clone());
        let values = Values(HashMap::from([("TOKEN".into(), "synthetic-token".into())]));
        assert!(claim(&r.session_id, &r.id, &values, false).is_err());
        assert!(
            claim(&r.session_id, &r.id, &values, true)
                .unwrap()
                .keep_file
        );
        REQUESTS.lock().unwrap().remove(&r.id);
    }

    #[tokio::test]
    async fn a_real_command_receives_env_and_echoed_values_are_redacted() {
        let values = HashMap::from([("TOKEN".into(), "synthetic-token-123".into())]);
        let command = vec![
            "/bin/sh".into(),
            "-c".into(),
            "printf 'result=%s' \"$TOKEN\"; printf '%s' \"$TOKEN\" >&2".into(),
        ];
        let (output, code) = run(&command, "/tmp", &values, None).await.unwrap();
        assert_eq!(code, Some(0));
        assert_eq!(output.as_deref(), Some("result=[redacted][redacted]"));
    }

    #[tokio::test]
    async fn private_files_are_not_overwritten_and_are_removed_after_failure() {
        let dir = std::env::temp_dir().join(format!("carbon-secret-test-{}", uuid::Uuid::new_v4()));
        private_dir(&dir).unwrap();
        let path = dir.join("secrets.env");
        let values = HashMap::from([("TOKEN".into(), "synthetic\n\"value".into())]);
        let body = env_file(&values).unwrap();
        private_file(&path, body.as_bytes()).unwrap();
        assert_eq!(
            std::fs::metadata(&dir).unwrap().permissions().mode() & 0o777,
            0o700
        );
        assert_eq!(
            std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        assert!(private_file(&path, b"replacement").is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), body.as_str());
        let mut cleanup = TempFile(Some(path.clone()));
        let command = vec![
            "/bin/sh".into(),
            "-c".into(),
            "cat \"$CARBON_SECRET_FILE\"; exit 7".into(),
        ];
        let (output, code) = run(&command, "/tmp", &HashMap::new(), Some(&path))
            .await
            .unwrap();
        assert_eq!(code, Some(7));
        assert_eq!(redact(&output.unwrap(), &values), "TOKEN='[redacted]'\n");
        cleanup.remove().unwrap();
        assert!(!path.exists());
        assert!(!dir.exists());
    }

    #[test]
    fn destinations_reject_symlinks_escape_and_insecure_browser_origins() {
        let dir = std::env::temp_dir().join(format!("carbon-secret-path-{}", uuid::Uuid::new_v4()));
        private_dir(&dir).unwrap();
        let dir = dir.canonicalize().unwrap();
        std::os::unix::fs::symlink("/tmp", dir.join("outside")).unwrap();
        assert!(keep_path(&dir, "outside/token.env").is_err());
        assert!(keep_path(&dir, "../token.env").is_err());
        let fields = handoff().fields;
        for origin in [
            "http://example.com",
            "https://example.com/path",
            "https://user:pass@example.com",
        ] {
            let target = SecretTarget::Browser {
                origin: origin.into(),
                fields: vec![carbon_proto::SecretSelector {
                    name: "TOKEN".into(),
                    selector: "#token".into(),
                }],
                submit: "button".into(),
            };
            assert!(validate("Test", &fields, &target).is_err());
        }
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[tokio::test]
    async fn kept_file_preflight_rejects_existing_and_unignored_paths() {
        let dir =
            std::env::temp_dir().join(format!("carbon-secret-preflight-{}", uuid::Uuid::new_v4()));
        private_dir(&dir).unwrap();
        assert!(Command::new("git")
            .args(["init", "--quiet"])
            .current_dir(&dir)
            .status()
            .await
            .unwrap()
            .success());
        assert!(kept_file_problem(&dir, &dir.join(".env.unignored"))
            .await
            .unwrap()
            .contains("ignored"));
        std::fs::write(dir.join(".gitignore"), ".env.kept\n").unwrap();
        assert!(kept_file_problem(&dir, &dir.join(".env.kept"))
            .await
            .is_none());
        std::fs::write(dir.join(".env.kept"), "original").unwrap();
        assert!(kept_file_problem(&dir, &dir.join(".env.kept"))
            .await
            .unwrap()
            .contains("already exists"));
        std::fs::remove_dir_all(dir).unwrap();
    }
}
