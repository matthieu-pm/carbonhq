//! A session's preview: the project's dev command run in the session's own
//! checkout on a port Carbon picked, owned by the server that runs the session
//! (CBN-77). The command and the app's folder are saved per project; the
//! process, its port and its log live here and nowhere else.
//!
//! Three rules the rest leans on:
//!
//! - **A run owns every process group its tree forms.** The command starts
//!   in a group of its own, and the groups its descendants move into are
//!   found and kept while it runs — pnpm puts the real server in a group of
//!   its own. Every ending — stop, crash, eviction, settle — signals all of
//!   them, so the server dies with the run even after the leader has exited.
//! - **Ready means one of those groups listens and answers HTTP.** A listener
//!   on the port from any other process is never shown as this session's
//!   app, and the URL names the loopback family the run owns rather than
//!   `localhost`, which could reach the other one.
//! - **Every run has a generation.** A readiness check or exit landing after a
//!   stop or a newer start belongs to a run that is gone and changes nothing.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::net::{Ipv4Addr, Ipv6Addr, SocketAddr};
use std::path::{Component, Path, PathBuf};
use std::process::{ExitStatus, Stdio};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::process::{Child, Command};
use ts_rs::TS;

use crate::sink::Sink;

/// Starting or running previews per server; a fourth stops the oldest.
const MAX_PREVIEWS: usize = 3;
const LOG_LIMIT: usize = 64 * 1024;
const EVENT: &str = "preview_changed";
const CONFIG_FILE: &str = "previews.json";

/// What a project runs to preview: a folder relative to the session's
/// checkout (`""` for its root) and a shell command, where `{port}` is
/// replaced by the port Carbon picked. `PORT` carries it too.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct PreviewConfig {
    pub directory: String,
    pub command: String,
}

/// What the first-start form needs: the project's saved config, if any, and a
/// command read off `package.json` in the chosen folder (`""` for none).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct PreviewSetup {
    pub config: Option<PreviewConfig>,
    pub suggested_command: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "lowercase")]
pub enum PreviewStatus {
    Starting,
    Running,
    Stopped,
    Failed,
}

impl PreviewStatus {
    fn is_live(self) -> bool {
        matches!(self, Self::Starting | Self::Running)
    }
}

/// One session's preview. `url` is set only while running and is always an
/// explicit loopback address (`http://127.0.0.1:<port>` or
/// `http://[::1]:<port>`); `message` says why a run stopped or failed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct PreviewState {
    pub session_id: String,
    pub status: PreviewStatus,
    pub config: PreviewConfig,
    pub port: u16,
    pub url: Option<String>,
    pub message: Option<String>,
}

static MANAGER: LazyLock<Arc<Manager>> =
    LazyLock::new(|| Arc::new(Manager::new(Timing::default(), MAX_PREVIEWS, true)));

/// The saved config for the session's project, and a suggested command for
/// `directory` (or the saved folder, or the checkout's root).
#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn preview_setup(
    session_id: String,
    directory: Option<String>,
) -> Result<PreviewSetup, String> {
    let item = session(&session_id).await?;
    let config = saved_config(&item.project_path).await?;
    let explicit = directory.is_some();
    let directory = directory
        .or_else(|| config.as_ref().map(|c| c.directory.clone()))
        .unwrap_or_default();
    // A saved folder missing from this checkout still answers its config;
    // start is what refuses it.
    let dir = match confine(Path::new(&item.cwd), &directory) {
        Ok((_, dir)) => Some(dir),
        Err(e) if explicit => return Err(e),
        Err(_) => None,
    };
    let root = crate::git::resolved(Path::new(&item.cwd));
    let suggested_command = match dir {
        Some(dir) => tokio::task::spawn_blocking(move || suggest(&dir, &root))
            .await
            .unwrap_or_default(),
        None => String::new(),
    };
    Ok(PreviewSetup {
        config,
        suggested_command,
    })
}

/// Starts the session's preview, replacing one it already runs. A `config`
/// is validated and saved for the project first; `None` runs the saved one.
/// Answers `starting` at once; readiness arrives as `preview_changed`.
#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn preview_start(
    sink: Sink,
    session_id: String,
    config: Option<PreviewConfig>,
) -> Result<PreviewState, String> {
    let item = session(&session_id).await?;
    if item.archived {
        return Err("This session is settled. Unsettle it to run a preview.".into());
    }
    if item.worktree_removed {
        return Err("This session's worktree was removed.".into());
    }
    let cwd = PathBuf::from(&item.cwd);
    let config = match config {
        Some(config) => {
            let (config, _) = prepare(&cwd, config)?;
            save_config(&item.project_path, &config).await?;
            config
        }
        None => saved_config(&item.project_path)
            .await?
            .ok_or("No preview command is saved for this project yet.")?,
    };
    MANAGER.start(Some(sink), &session_id, &cwd, config).await
}

/// The session's preview as it stands, stopped and failed ones included.
#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn preview_status(session_id: String) -> Result<Option<PreviewState>, String> {
    Ok(MANAGER.status(&session_id))
}

/// Stops the session's preview and waits for its processes to end. Stopping
/// one that is not running answers its state unchanged.
#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn preview_stop(sink: Sink, session_id: String) -> Result<Option<PreviewState>, String> {
    Ok(MANAGER.stop(Some(sink), &session_id).await)
}

/// The last 64KiB the session's latest run printed, stdout and stderr together.
#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn preview_logs(session_id: String) -> Result<String, String> {
    Ok(MANAGER.logs(&session_id))
}

/// Stops and forgets the session's preview, for settle and delete. Write the
/// settled flag first: a start already past its own check reads it again
/// before spawning.
pub async fn close_session(session_id: &str) {
    MANAGER.close(session_id).await;
}

/// Every preview this server knows of, for a client reconnecting.
pub async fn states() -> Vec<PreviewState> {
    MANAGER.states()
}

/// Stops every preview, for a server shutting down.
pub async fn stop_all() {
    let ids: Vec<String> = MANAGER.states().into_iter().map(|s| s.session_id).collect();
    futures_util::future::join_all(ids.iter().map(|id| MANAGER.stop(None, id))).await;
}

async fn session(session_id: &str) -> Result<crate::store::SessionIndexItem, String> {
    crate::store::get_session_index_item(session_id)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "No such session.".to_string())
}

#[derive(Debug, Clone, Copy)]
struct Timing {
    /// From spawn to an owned listener answering HTTP.
    ready_within: Duration,
    poll: Duration,
    /// Between SIGTERM and SIGKILL.
    grace: Duration,
    /// For one HTTP answer: a first request can wait on a whole compile.
    answer_within: Duration,
}

impl Default for Timing {
    fn default() -> Self {
        Self {
            ready_within: Duration::from_secs(120),
            poll: Duration::from_millis(300),
            grace: Duration::from_secs(3),
            answer_within: Duration::from_secs(15),
        }
    }
}

struct Manager {
    inner: Mutex<Previews>,
    timing: Timing,
    limit: usize,
    /// Re-read the session's settled flag before spawning. Off in tests,
    /// which have no index.
    check_store: bool,
}

#[derive(Default)]
struct Previews {
    entries: HashMap<String, Entry>,
    next_gen: u64,
    /// The last sink a command supplied, so settle can still report.
    sink: Option<Sink>,
}

/// Every process group a run's tree has formed, the root's first among them.
/// Shared between the run's watcher, which adds to it, and the ending that
/// signals it.
type Groups = Arc<Mutex<HashSet<i32>>>;

struct Entry {
    gen: u64,
    state: PreviewState,
    started: Instant,
    /// The run's process groups, held only while they may be alive. Taken by
    /// whichever ending signals them, so they are never signalled twice.
    groups: Option<Groups>,
    log: Arc<Mutex<Log>>,
}

impl Previews {
    fn fresh(&mut self) -> u64 {
        self.next_gen += 1;
        self.next_gen
    }

    /// Ends `session`'s run where `gen` is still its run (any run for
    /// `None`), answering the state and the group to signal. `outcome` reads
    /// the state it replaces, under the same lock.
    fn end(
        &mut self,
        session: &str,
        gen: Option<u64>,
        outcome: impl FnOnce(&PreviewState) -> (PreviewStatus, Option<String>),
    ) -> Option<(PreviewState, Option<Groups>)> {
        let fresh = self.fresh();
        let entry = self.entries.get_mut(session)?;
        if gen.is_some_and(|g| g != entry.gen) {
            return None;
        }
        entry.gen = fresh;
        let group = entry.groups.take();
        if entry.state.status.is_live() {
            (entry.state.status, entry.state.message) = outcome(&entry.state);
            entry.state.url = None;
            let state = entry.state.clone();
            self.emit(&state);
        }
        let state = self.entries.get(session)?.state.clone();
        Some((state, group))
    }

    /// Called with the lock held, so events leave in the order the states
    /// changed: emitted after unlocking, a stop still killing its group could
    /// report `stopped` after a newer run's `starting`.
    fn emit(&self, state: &PreviewState) {
        if let Some(sink) = &self.sink {
            if let Err(e) = sink.emit(EVENT, state) {
                eprintln!("[preview emit err] {e}");
            }
        }
    }
}

/// What a spawned run needs, gathered under the lock.
struct Run {
    session: String,
    gen: u64,
    dir: PathBuf,
    command: String,
    port: u16,
    /// This session's previous group, which must be gone before the new one
    /// starts: two dev servers in one folder fight over its lock files.
    replaced: Option<Groups>,
    log: Arc<Mutex<Log>>,
}

impl Manager {
    fn new(timing: Timing, limit: usize, check_store: bool) -> Self {
        Self {
            inner: Mutex::default(),
            timing,
            limit,
            check_store,
        }
    }

    async fn start(
        self: &Arc<Self>,
        sink: Option<Sink>,
        session_id: &str,
        cwd: &Path,
        config: PreviewConfig,
    ) -> Result<PreviewState, String> {
        let (config, dir) = prepare(cwd, config)?;
        let log = Arc::new(Mutex::new(Log::default()));
        let (state, run, evicted) = {
            let mut p = self.inner.lock().unwrap();
            // First, so a failure leaves every entry and group as it was.
            let taken: HashSet<u16> = p
                .entries
                .values()
                .filter(|e| e.state.status.is_live())
                .map(|e| e.state.port)
                .collect();
            let port = pick_port(&taken)?;
            if sink.is_some() {
                p.sink = sink;
            }
            let replaced = p.entries.get_mut(session_id).and_then(|e| e.groups.take());

            let mut live: Vec<(Instant, String)> = p
                .entries
                .iter()
                .filter(|(id, e)| id.as_str() != session_id && e.state.status.is_live())
                .map(|(id, e)| (e.started, id.clone()))
                .collect();
            live.sort();
            let mut evicted = Vec::new();
            while live.len() >= self.limit.max(1) {
                let (_, oldest) = live.remove(0);
                let room = |_: &PreviewState| {
                    let message = "Stopped to make room for a newer preview.";
                    (PreviewStatus::Stopped, Some(message.to_string()))
                };
                evicted.extend(p.end(&oldest, None, room).and_then(|(_, groups)| groups));
            }

            let gen = p.fresh();
            let state = PreviewState {
                session_id: session_id.to_string(),
                status: PreviewStatus::Starting,
                config: config.clone(),
                port,
                url: None,
                message: None,
            };
            let entry = Entry {
                gen,
                state: state.clone(),
                started: Instant::now(),
                groups: None,
                log: log.clone(),
            };
            p.entries.insert(session_id.to_string(), entry);
            p.emit(&state);
            let run = Run {
                session: session_id.to_string(),
                gen,
                dir,
                command: config.command.replace("{port}", &port.to_string()),
                port,
                replaced,
                log,
            };
            (state, run, evicted)
        };

        for groups in evicted {
            tokio::spawn(end_groups(groups, self.timing.grace));
        }
        tokio::spawn(self.clone().launch(run));
        Ok(state)
    }

    async fn launch(self: Arc<Self>, run: Run) {
        if let Some(groups) = run.replaced.clone() {
            end_groups(groups, self.timing.grace).await;
        }
        if self.check_store && settled(&run.session).await {
            let message = Some("The session is settled.".to_string());
            self.finish(&run.session, run.gen, PreviewStatus::Stopped, message)
                .await;
            return;
        }
        if !self.current(&run.session, run.gen) {
            return;
        }

        run.log
            .lock()
            .unwrap()
            .push(format!("$ {}\n", run.command).as_bytes());
        let mut child = match spawn(&run) {
            Ok(child) => child,
            Err(e) => {
                let message = Some(format!("Could not start the command: {e}"));
                self.finish(&run.session, run.gen, PreviewStatus::Failed, message)
                    .await;
                return;
            }
        };
        let Some(pgid) = child.id().map(|pid| pid as i32) else {
            return;
        };
        if let Some(out) = child.stdout.take() {
            tokio::spawn(pump(out, run.log.clone()));
        }
        if let Some(err) = child.stderr.take() {
            tokio::spawn(pump(err, run.log.clone()));
        }

        let groups: Groups = Arc::new(Mutex::new(HashSet::from([pgid])));
        let registered = {
            let mut p = self.inner.lock().unwrap();
            match p.entries.get_mut(&run.session) {
                Some(e) if e.gen == run.gen => {
                    e.groups = Some(groups.clone());
                    true
                }
                _ => false,
            }
        };
        if !registered {
            // Stopped between the check and the spawn: nobody else holds this run.
            end_groups(groups, self.timing.grace).await;
            let _ = child.wait().await;
            return;
        }

        let me = self.clone();
        let (session, gen, log) = (run.session.clone(), run.gen, run.log.clone());
        tokio::spawn(async move {
            let status = child.wait().await;
            me.exited(&session, gen, status, &log).await;
        });
        self.await_ready(&run, &groups).await;
        // Groups formed after readiness are the run's too: a stop after the
        // leader has gone finds them only through what was recorded here.
        loop {
            tokio::time::sleep(Duration::from_secs(1)).await;
            if !self.current(&run.session, run.gen) {
                break;
            }
            refresh(&groups).await;
        }
    }

    async fn await_ready(&self, run: &Run, groups: &Groups) {
        let deadline = Instant::now() + self.timing.ready_within;
        let mut holder: Option<String> = None;
        loop {
            if !self.current(&run.session, run.gen) {
                return;
            }
            if Instant::now() >= deadline {
                let port = run.port;
                let message = match holder {
                    Some(h) => format!("Port {port} is held by {h}, not this preview."),
                    None => format!(
                        "Nothing from the command answered on port {port} within {}s. Check that it uses {{port}} or $PORT.",
                        self.timing.ready_within.as_secs()
                    ),
                };
                self.finish(&run.session, run.gen, PreviewStatus::Failed, Some(message))
                    .await;
                return;
            }
            let port = run.port;
            let owned = refresh(groups).await;
            let found = listeners(port).await;
            match judge(&found, &owned, port) {
                Verdict::Wait(h) => holder = h.or(holder),
                Verdict::Conflict(message) => {
                    self.finish(&run.session, run.gen, PreviewStatus::Failed, Some(message))
                        .await;
                    return;
                }
                Verdict::Ready(addr) => {
                    if answers_http(addr, self.timing.answer_within).await {
                        self.ready(&run.session, run.gen, format!("http://{addr}"));
                        return;
                    }
                }
            }
            tokio::time::sleep(self.timing.poll).await;
        }
    }

    fn ready(&self, session: &str, gen: u64, url: String) {
        let mut p = self.inner.lock().unwrap();
        let Some(e) = p.entries.get_mut(session) else {
            return;
        };
        if e.gen != gen || e.state.status != PreviewStatus::Starting {
            return;
        }
        e.state.status = PreviewStatus::Running;
        e.state.url = Some(url);
        e.state.message = None;
        let state = e.state.clone();
        p.emit(&state);
    }

    async fn exited(
        &self,
        session: &str,
        gen: u64,
        status: std::io::Result<ExitStatus>,
        log: &Mutex<Log>,
    ) {
        let how = match &status {
            Ok(s) => describe(s),
            Err(e) => format!("could not be waited on ({e})"),
        };
        log.lock().unwrap().push(format!("\n[{how}]\n").as_bytes());
        let clean = matches!(&status, Ok(s) if s.success());
        let ended = self.inner.lock().unwrap().end(session, Some(gen), |was| {
            match (was.status == PreviewStatus::Running, clean) {
                (false, _) => (
                    PreviewStatus::Failed,
                    Some(format!("The command {how} before the preview was ready.")),
                ),
                (true, true) => (
                    PreviewStatus::Stopped,
                    Some(format!("The dev server {how}.")),
                ),
                (true, false) => (
                    PreviewStatus::Failed,
                    Some(format!("The dev server {how}.")),
                ),
            }
        });
        if let Some((_, Some(groups))) = ended {
            end_groups(groups, self.timing.grace).await;
        }
    }

    /// Ends the run `gen` if it is still current, then signals its group.
    async fn finish(
        &self,
        session: &str,
        gen: u64,
        status: PreviewStatus,
        message: Option<String>,
    ) {
        let ended = self
            .inner
            .lock()
            .unwrap()
            .end(session, Some(gen), |_| (status, message));
        if let Some((_, Some(groups))) = ended {
            end_groups(groups, self.timing.grace).await;
        }
    }

    async fn stop(&self, sink: Option<Sink>, session: &str) -> Option<PreviewState> {
        let ended = {
            let mut p = self.inner.lock().unwrap();
            if sink.is_some() {
                p.sink = sink;
            }
            p.end(session, None, |_| (PreviewStatus::Stopped, None))
        };
        let (state, groups) = ended?;
        if let Some(groups) = groups {
            end_groups(groups, self.timing.grace).await;
        }
        Some(state)
    }

    async fn close(&self, session: &str) {
        let ended = {
            let mut p = self.inner.lock().unwrap();
            let ended = p.end(session, None, |_| (PreviewStatus::Stopped, None));
            p.entries.remove(session);
            ended
        };
        if let Some((_, Some(groups))) = ended {
            end_groups(groups, self.timing.grace).await;
        }
    }

    fn current(&self, session: &str, gen: u64) -> bool {
        self.inner
            .lock()
            .unwrap()
            .entries
            .get(session)
            .is_some_and(|e| e.gen == gen)
    }

    fn status(&self, session: &str) -> Option<PreviewState> {
        self.inner
            .lock()
            .unwrap()
            .entries
            .get(session)
            .map(|e| e.state.clone())
    }

    fn states(&self) -> Vec<PreviewState> {
        self.inner
            .lock()
            .unwrap()
            .entries
            .values()
            .map(|e| e.state.clone())
            .collect()
    }

    fn logs(&self, session: &str) -> String {
        let log = self
            .inner
            .lock()
            .unwrap()
            .entries
            .get(session)
            .map(|e| e.log.clone());
        log.map(|l| l.lock().unwrap().text()).unwrap_or_default()
    }
}

/// Gone from the index, or its worktree removed, counts as settled: nothing
/// is left to preview.
async fn settled(session: &str) -> bool {
    match crate::store::get_session_index_item(session).await {
        Ok(Some(item)) => item.archived || item.worktree_removed,
        Ok(None) => true,
        Err(_) => false,
    }
}

fn describe(status: &ExitStatus) -> String {
    use std::os::unix::process::ExitStatusExt;
    match (status.code(), status.signal()) {
        (Some(code), _) => format!("exited with code {code}"),
        (None, Some(signal)) => format!("was ended by signal {signal}"),
        _ => "exited".to_string(),
    }
}

/// The command under the reader's login shell, so `PATH` and version managers
/// set in their profile apply. Its own process group, so the whole tree can be
/// signalled at once.
fn spawn(run: &Run) -> std::io::Result<Child> {
    let shell = std::env::var("SHELL")
        .ok()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "/bin/sh".into());
    Command::new(shell)
        .args(["-l", "-c", &run.command])
        .current_dir(&run.dir)
        .env("PORT", run.port.to_string())
        .env(
            "PATH",
            crate::binpath::child_path(crate::binpath::resolved_bin_dirs()),
        )
        // Create React App and friends open a browser of their own otherwise.
        .env("BROWSER", "none")
        .env("FORCE_COLOR", "0")
        .env("NO_COLOR", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .process_group(0)
        .spawn()
}

async fn pump(mut reader: impl AsyncRead + Unpin, log: Arc<Mutex<Log>>) {
    let mut buf = [0u8; 8192];
    while let Ok(n) = reader.read(&mut buf).await {
        if n == 0 {
            break;
        }
        log.lock().unwrap().push(&buf[..n]);
    }
}

/// SIGTERM to every group the run formed, then SIGKILL to what is left once
/// `grace` runs out. Each pass looks for groups again, so a server forking
/// into a new group while it shuts down is caught too. A group outlives its
/// leader while any member lives, which is what reaches a grandchild after
/// the shell has gone.
async fn end_groups(groups: Groups, grace: Duration) {
    let mut termed = HashSet::new();
    let deadline = Instant::now() + grace;
    loop {
        let all = refresh(&groups).await;
        for &pgid in all.difference(&termed) {
            signal_group(pgid, libc::SIGTERM);
        }
        termed.extend(all.iter().copied());
        if all.is_empty() || Instant::now() >= deadline {
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    let deadline = Instant::now() + Duration::from_secs(2);
    loop {
        let all = refresh(&groups).await;
        if all.is_empty() || Instant::now() >= deadline {
            break;
        }
        for pgid in all {
            signal_group(pgid, libc::SIGKILL);
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

/// Drops the groups that have died, adds any the survivors' trees have
/// formed, and answers the set. Pruning first matters: a dead group's number
/// can come back as an unrelated shell job, which must never be signalled.
async fn refresh(groups: &Groups) -> HashSet<i32> {
    let known: HashSet<i32> = groups.lock().unwrap().clone();
    let known: HashSet<i32> = known.into_iter().filter(|&g| group_alive(g)).collect();
    let found = if known.is_empty() {
        known
    } else {
        discover(&known).await
    };
    // Merged rather than assigned: the watcher and an ending refresh one set
    // at once, and neither may drop what the other found.
    let mut set = groups.lock().unwrap();
    set.extend(found);
    set.retain(|&g| group_alive(g));
    set.clone()
}

/// How long a `ps` or `lsof` may take. Unbounded, one that stalls would hold
/// a readiness loop, and a runtime's shutdown, forever.
const PROBE_LIMIT: Duration = Duration::from_secs(5);

/// A probe's stdout, or nothing where it failed or ran past [`PROBE_LIMIT`].
#[cfg_attr(target_os = "linux", allow(dead_code))]
async fn probe(bin: &str, args: &[&str]) -> Option<String> {
    let output = Command::new(bin)
        .args(args)
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .output();
    let output = tokio::time::timeout(PROBE_LIMIT, output).await.ok()?.ok()?;
    Some(String::from_utf8_lossy(&output.stdout).into_owned())
}

/// `known` plus the group of every process descending from a member of one.
async fn discover(known: &HashSet<i32>) -> HashSet<i32> {
    let Some(rows) = process_rows().await else {
        return known.clone();
    };
    // A descendant may join this server's own group; signalling that would
    // stop the server itself.
    let ours = unsafe { libc::getpgrp() };
    tree_groups(&rows, known, ours)
}

/// `(pid, ppid, pgid)` for every process.
#[cfg(not(target_os = "linux"))]
async fn process_rows() -> Option<Vec<(i32, i32, i32)>> {
    Some(parse_ps(&probe("ps", &["-axo", "pid=,ppid=,pgid="]).await?))
}

/// The same off `/proc`, since a minimal Linux server may have no `ps`.
#[cfg(target_os = "linux")]
async fn process_rows() -> Option<Vec<(i32, i32, i32)>> {
    tokio::task::spawn_blocking(|| {
        let rows: Vec<(i32, i32, i32)> = std::fs::read_dir("/proc")
            .ok()?
            .flatten()
            .filter_map(|entry| {
                let pid = entry.file_name().to_string_lossy().parse::<i32>().ok()?;
                let stat = std::fs::read_to_string(entry.path().join("stat")).ok()?;
                let (ppid, pgid) = stat_parents(&stat)?;
                Some((pid, ppid, pgid))
            })
            .collect();
        Some(rows)
    })
    .await
    .ok()
    .flatten()
}

#[cfg_attr(target_os = "linux", allow(dead_code))]
fn parse_ps(text: &str) -> Vec<(i32, i32, i32)> {
    text.lines()
        .filter_map(|line| {
            let mut it = line.split_whitespace().map(|f| f.parse::<i32>().ok());
            Some((it.next()??, it.next()??, it.next()??))
        })
        .collect()
}

fn tree_groups(rows: &[(i32, i32, i32)], known: &HashSet<i32>, exclude: i32) -> HashSet<i32> {
    let mut children: HashMap<i32, Vec<(i32, i32)>> = HashMap::new();
    for &(pid, ppid, pgid) in rows {
        children.entry(ppid).or_default().push((pid, pgid));
    }
    let mut stack: Vec<i32> = rows
        .iter()
        .filter(|(_, _, pgid)| known.contains(pgid))
        .map(|(pid, _, _)| *pid)
        .collect();
    let mut seen: HashSet<i32> = stack.iter().copied().collect();
    let mut found = known.clone();
    while let Some(pid) = stack.pop() {
        for &(child, pgid) in children.get(&pid).into_iter().flatten() {
            if seen.insert(child) {
                found.insert(pgid);
                stack.push(child);
            }
        }
    }
    found.retain(|&g| g > 1 && g != exclude);
    found
}

fn signal_group(pgid: i32, signal: i32) {
    unsafe { libc::kill(-pgid, signal) };
}

fn group_alive(pgid: i32) -> bool {
    let sent = unsafe { libc::kill(-pgid, 0) } == 0;
    sent || std::io::Error::last_os_error().raw_os_error() != Some(libc::ESRCH)
}

/// A port free on both loopbacks and held by no other preview. Freed again
/// before the command binds it, so a race is possible; readiness is what
/// catches one.
fn pick_port(taken: &HashSet<u16>) -> Result<u16, String> {
    for _ in 0..50 {
        let Ok(v4) = std::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0)) else {
            continue;
        };
        let Ok(addr) = v4.local_addr() else { continue };
        let port = addr.port();
        if taken.contains(&port) {
            continue;
        }
        match std::net::TcpListener::bind((Ipv6Addr::LOCALHOST, port)) {
            Ok(_) => return Ok(port),
            // A machine with no IPv6 loopback has nothing to clash with there.
            Err(e) if e.kind() == std::io::ErrorKind::AddrNotAvailable => return Ok(port),
            Err(_) => continue,
        }
    }
    Err("Could not find a free port.".into())
}

/// Validates a config against a checkout, answering it normalised and the
/// absolute folder it runs in.
fn prepare(cwd: &Path, config: PreviewConfig) -> Result<(PreviewConfig, PathBuf), String> {
    let command = config.command.trim();
    if command.is_empty() {
        return Err("The preview command is empty.".into());
    }
    if command.contains('\0') {
        return Err("The preview command contains a NUL byte.".into());
    }
    let (directory, dir) = confine(cwd, &config.directory)?;
    Ok((
        PreviewConfig {
            directory,
            command: command.to_string(),
        },
        dir,
    ))
}

/// `relative` under `cwd`, refusing anything that leaves it — `..`, an
/// absolute path, or a symlink pointing out. Answers the folder as saved
/// (`/`-joined, `""` for the root) and its resolved path.
fn confine(cwd: &Path, relative: &str) -> Result<(String, PathBuf), String> {
    let outside = || format!("\"{relative}\" is outside the session's folder.");
    if relative.contains('\0') {
        return Err(outside());
    }
    let mut parts = Vec::new();
    for component in Path::new(relative.trim()).components() {
        match component {
            Component::Normal(part) => parts.push(part.to_string_lossy().into_owned()),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(outside())
            }
        }
    }
    let directory = parts.join("/");
    let root = std::fs::canonicalize(cwd)
        .map_err(|_| format!("The session's folder {} is missing.", cwd.display()))?;
    let dir = std::fs::canonicalize(root.join(&directory))
        .map_err(|_| format!("There is no folder \"{directory}\" in this checkout."))?;
    if !dir.starts_with(&root) {
        return Err(outside());
    }
    if !dir.is_dir() {
        return Err(format!("\"{directory}\" is not a folder."));
    }
    Ok((directory, dir))
}

/// A run command for the `package.json` in `dir`, with the port flag its dev
/// server takes, or `""` where there is nothing to run. `root` bounds the walk
/// up for a lockfile, which in a monorepo sits above the app.
fn suggest(dir: &Path, root: &Path) -> String {
    let Ok(text) = std::fs::read_to_string(dir.join("package.json")) else {
        return String::new();
    };
    let Ok(pkg) = serde_json::from_str::<serde_json::Value>(&text) else {
        return String::new();
    };
    let scripts = pkg.get("scripts").and_then(|s| s.as_object());
    let Some((name, body)) = ["dev", "start", "serve", "develop", "preview"]
        .into_iter()
        .find_map(|name| Some((name, scripts?.get(name)?.as_str()?)))
    else {
        return String::new();
    };
    let manager = package_manager(&pkg, dir, root);
    let run = format!("{manager} run {name}");
    match port_flag(body) {
        // npm keeps arguments for itself unless they follow `--`; pnpm passes
        // a `--` on to the script, where Vite then ignores what follows.
        Some(flag) if manager == "npm" => format!("{run} -- {flag}"),
        Some(flag) => format!("{run} {flag}"),
        None => run,
    }
}

fn package_manager(pkg: &serde_json::Value, dir: &Path, root: &Path) -> &'static str {
    const KNOWN: [&str; 4] = ["pnpm", "yarn", "bun", "npm"];
    if let Some(declared) = pkg.get("packageManager").and_then(|v| v.as_str()) {
        let name = declared.split('@').next().unwrap_or_default();
        if let Some(known) = KNOWN.into_iter().find(|k| *k == name) {
            return known;
        }
    }
    const LOCKS: [(&str, &str); 5] = [
        ("pnpm-lock.yaml", "pnpm"),
        ("yarn.lock", "yarn"),
        ("bun.lock", "bun"),
        ("bun.lockb", "bun"),
        ("package-lock.json", "npm"),
    ];
    let mut at = Some(dir);
    while let Some(here) = at {
        if let Some((_, manager)) = LOCKS.iter().find(|(file, _)| here.join(file).is_file()) {
            return manager;
        }
        if here == root {
            break;
        }
        at = here.parent().filter(|p| p.starts_with(root));
    }
    "npm"
}

/// The port flag for the dev server a script runs, where it takes one. `None`
/// leaves the port to `PORT` — Create React App's way, and the safe answer for
/// a script chaining several commands, where a flag would land on the last.
fn port_flag(script: &str) -> Option<&'static str> {
    if ["&&", "||", ";", "|"].iter().any(|s| script.contains(s)) {
        return None;
    }
    let tokens: Vec<&str> = script
        .split_whitespace()
        .map(|t| t.trim_matches(|c| c == '"' || c == '\''))
        .map(|t| t.rsplit('/').next().unwrap_or(t))
        .collect();
    let has = |name: &str| tokens.contains(&name);
    if ["concurrently", "run-p", "npm-run-all", "turbo"]
        .into_iter()
        .any(has)
    {
        return None;
    }
    if has("next") || has("gatsby") {
        Some("-p {port}")
    } else if has("vite")
        || has("vite:dev")
        || has("react-router")
        || (has("remix") && has("vite:dev"))
    {
        // Vite moves to the next port when its own is taken; strict makes that a crash.
        Some("--port {port} --strictPort")
    } else if [
        "astro",
        "nuxt",
        "nuxi",
        "webpack-dev-server",
        "vue-cli-service",
        "parcel",
        "expo",
    ]
    .into_iter()
    .any(has)
        || (has("ng") && has("serve"))
        || (has("webpack") && has("serve"))
    {
        Some("--port {port}")
    } else {
        None
    }
}

async fn config_path() -> Result<PathBuf, String> {
    Ok(crate::store::config_dir()
        .await
        .map_err(|e| e.to_string())?
        .join(CONFIG_FILE))
}

/// The project's saved config. Shared by every home on this machine, like
/// projects themselves, so a command saved from one worktree's session is
/// there for the next.
async fn saved_config(project: &str) -> Result<Option<PreviewConfig>, String> {
    read_configs(&config_path().await?)
        .await
        .map(|mut all| all.remove(project))
}

async fn save_config(project: &str, config: &PreviewConfig) -> Result<(), String> {
    // Every server on this machine rewrites the file whole.
    let _lock = crate::store::lock_across_processes("previews").await;
    write_config(&config_path().await?, project, config).await
}

async fn read_configs(path: &Path) -> Result<BTreeMap<String, PreviewConfig>, String> {
    crate::store::read_json(path)
        .await
        .map_err(|e| e.to_string())
}

async fn write_config(path: &Path, project: &str, config: &PreviewConfig) -> Result<(), String> {
    let mut all = read_configs(path).await?;
    all.insert(project.to_string(), config.clone());
    let text = serde_json::to_string_pretty(&all).map_err(|e| e.to_string())?;
    crate::store::write_atomic(path, text)
        .await
        .map_err(|e| e.to_string())
}

#[derive(Default)]
struct Log {
    buf: Vec<u8>,
}

impl Log {
    fn push(&mut self, bytes: &[u8]) {
        self.buf.extend_from_slice(bytes);
        if self.buf.len() > LOG_LIMIT {
            let cut = self.buf.len() - LOG_LIMIT;
            self.buf.drain(..cut);
        }
    }

    /// Lossy, and starting on a character boundary, since the trim can cut one.
    fn text(&self) -> String {
        let start = self
            .buf
            .iter()
            .take(4)
            .position(|b| b & 0xC0 != 0x80)
            .unwrap_or(0);
        String::from_utf8_lossy(&self.buf[start..]).into_owned()
    }
}

/// A TCP listener on the preview's port, with the loopback families it answers.
#[derive(Debug, Clone, PartialEq)]
struct Listener {
    pid: u32,
    pgid: i32,
    name: String,
    v4: bool,
    v6: bool,
}

#[derive(Debug, PartialEq)]
enum Verdict {
    /// Nothing of ours listens yet; carries whatever else holds the port.
    Wait(Option<String>),
    /// Ours listens on this loopback and nothing else does there.
    Ready(SocketAddr),
    Conflict(String),
}

/// Which loopback, if any, reaches the run's groups and nothing else. A family held
/// by another process too is never used, since which of the two answers is
/// the kernel's choice.
fn judge(found: &[Listener], owned: &HashSet<i32>, port: u16) -> Verdict {
    let (owned, foreign): (Vec<&Listener>, Vec<&Listener>) = found
        .iter()
        .filter(|l| l.v4 || l.v6)
        .partition(|l| owned.contains(&l.pgid));
    let holder = |l: &Listener| format!("{} (pid {})", l.name, l.pid);
    if owned.is_empty() {
        return Verdict::Wait(foreign.first().map(|l| holder(l)));
    }
    let free = |family: fn(&Listener) -> bool| {
        owned.iter().any(|l| family(l)) && !foreign.iter().any(|l| family(l))
    };
    if free(|l| l.v4) {
        Verdict::Ready(SocketAddr::from((Ipv4Addr::LOCALHOST, port)))
    } else if free(|l| l.v6) {
        Verdict::Ready(SocketAddr::from((Ipv6Addr::LOCALHOST, port)))
    } else {
        Verdict::Conflict(format!(
            "Port {port} is also held by {}, so Carbon cannot tell which one would answer.",
            holder(foreign[0])
        ))
    }
}

/// Whether `addr` answers an HTTP request with anything at all; a 404 or a
/// host check's 403 is still the dev server answering.
async fn answers_http(addr: SocketAddr, wait: Duration) -> bool {
    let Ok(Ok(mut stream)) =
        tokio::time::timeout(Duration::from_secs(2), TcpStream::connect(addr)).await
    else {
        return false;
    };
    let request =
        format!("GET / HTTP/1.1\r\nHost: {addr}\r\nAccept: */*\r\nConnection: close\r\n\r\n");
    if stream.write_all(request.as_bytes()).await.is_err() {
        return false;
    }
    let mut head = [0u8; 5];
    matches!(
        tokio::time::timeout(wait, stream.read_exact(&mut head)).await,
        Ok(Ok(_))
    ) && &head == b"HTTP/"
}

/// Every listener on `port`, with its process group, from lsof.
#[cfg(not(target_os = "linux"))]
async fn listeners(port: u16) -> Vec<Listener> {
    let filter = format!("-iTCP:{port}");
    let out = probe("lsof", &["-nP", &filter, "-sTCP:LISTEN", "-Fpgctn"]).await;
    out.map(|text| parse_lsof(&text, port)).unwrap_or_default()
}

#[cfg(target_os = "linux")]
async fn listeners(port: u16) -> Vec<Listener> {
    tokio::task::spawn_blocking(move || proc_listeners(port))
        .await
        .unwrap_or_default()
}

/// The same off `/proc`, since a fresh Linux server has no lsof. Only this
/// user's processes are readable, which covers every preview it started.
#[cfg(target_os = "linux")]
fn proc_listeners(port: u16) -> Vec<Listener> {
    use std::fs;
    let sockets: HashMap<u64, (bool, bool)> = [("/proc/net/tcp", false), ("/proc/net/tcp6", true)]
        .iter()
        .filter_map(|(file, v6)| Some((fs::read_to_string(file).ok()?, *v6)))
        .flat_map(|(text, v6)| parse_proc_net(&text, v6, port))
        .map(|(inode, v4, v6)| (inode, (v4, v6)))
        .collect();
    let mut found = Vec::new();
    if sockets.is_empty() {
        return found;
    }
    let Ok(procs) = fs::read_dir("/proc") else {
        return found;
    };
    for entry in procs.flatten() {
        let Ok(pid) = entry.file_name().to_string_lossy().parse::<u32>() else {
            continue;
        };
        let Ok(fds) = fs::read_dir(entry.path().join("fd")) else {
            continue;
        };
        for fd in fds.flatten() {
            let Ok(link) = fs::read_link(fd.path()) else {
                continue;
            };
            let inode = link.to_str().and_then(|l| {
                l.strip_prefix("socket:[")?
                    .strip_suffix(']')?
                    .parse::<u64>()
                    .ok()
            });
            let Some(&(v4, v6)) = inode.and_then(|i| sockets.get(&i)) else {
                continue;
            };
            let stat = fs::read_to_string(entry.path().join("stat")).unwrap_or_default();
            let Some((_, pgid)) = stat_parents(&stat) else {
                continue;
            };
            let name = fs::read_to_string(entry.path().join("comm"))
                .unwrap_or_default()
                .trim()
                .to_string();
            found.push(Listener {
                pid,
                pgid,
                name,
                v4,
                v6,
            });
        }
    }
    found
}

/// lsof's machine format: `p`, `g` and `c` open a process, `t` and `n`
/// describe each of its sockets.
#[cfg_attr(target_os = "linux", allow(dead_code))]
fn parse_lsof(text: &str, port: u16) -> Vec<Listener> {
    let mut found = Vec::new();
    let (mut pid, mut pgid, mut name, mut kind) = (0u32, 0i32, String::new(), String::new());
    for line in text.lines().filter(|l| !l.is_empty()) {
        let (tag, rest) = line.split_at(1);
        match tag {
            "p" => (pid, pgid, kind) = (rest.parse().unwrap_or(0), 0, String::new()),
            "g" => pgid = rest.parse().unwrap_or(0),
            "c" => name = rest.to_string(),
            "f" => kind.clear(),
            "t" => kind = rest.to_string(),
            "n" => {
                let Some((host, p)) = rest.rsplit_once(':') else {
                    continue;
                };
                if p.parse::<u16>() != Ok(port) || pid == 0 {
                    continue;
                }
                let (v4, v6) = match (kind.as_str(), host) {
                    ("IPv4", "127.0.0.1" | "*" | "0.0.0.0") => (true, false),
                    ("IPv6", "[::1]") => (false, true),
                    // Dual-stack, the default for a wildcard IPv6 bind.
                    ("IPv6", "*" | "[::]") => (true, true),
                    ("IPv6", "[::ffff:127.0.0.1]") => (true, false),
                    _ => (false, false),
                };
                found.push(Listener {
                    pid,
                    pgid,
                    name: name.clone(),
                    v4,
                    v6,
                });
            }
            _ => {}
        }
    }
    found
}

/// `(inode, v4, v6)` for each listener on `port` in `/proc/net/tcp` or `tcp6`
/// that a loopback connection reaches. Addresses are hex per 32-bit word in
/// host order, ports plain hex; `0A` is LISTEN.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn parse_proc_net(text: &str, v6: bool, port: u16) -> Vec<(u64, bool, bool)> {
    text.lines()
        .skip(1)
        .filter_map(|line| {
            let f: Vec<&str> = line.split_whitespace().collect();
            let (addr, p) = f.get(1)?.split_once(':')?;
            if *f.get(3)? != "0A" || u16::from_str_radix(p, 16).ok()? != port {
                return None;
            }
            let families = match (v6, addr) {
                (false, "0100007F" | "00000000") => (true, false),
                (true, "00000000000000000000000001000000") => (false, true),
                (true, "0000000000000000FFFF00000100007F") => (true, false),
                (true, a) if a.bytes().all(|b| b == b'0') => (true, true),
                _ => return None,
            };
            Some((f.get(9)?.parse().ok()?, families.0, families.1))
        })
        .collect()
}

/// The parent and process group in `/proc/<pid>/stat`: the second and third
/// fields after the command, which is parenthesised and may itself hold
/// spaces or `)`.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn stat_parents(stat: &str) -> Option<(i32, i32)> {
    let mut fields = stat.rsplit_once(')')?.1.split_whitespace().skip(1);
    Some((fields.next()?.parse().ok()?, fields.next()?.parse().ok()?))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn quick() -> Timing {
        Timing {
            ready_within: Duration::from_secs(20),
            poll: Duration::from_millis(100),
            grace: Duration::from_secs(2),
            answer_within: Duration::from_secs(5),
        }
    }

    fn manager(limit: usize, timing: Timing) -> Arc<Manager> {
        Arc::new(Manager::new(timing, limit, false))
    }

    fn tempdir(tag: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("carbon-preview-{tag}-{}", uuid::Uuid::now_v7()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Every state the manager reports, in order.
    fn recorder() -> (Sink, Arc<Mutex<Vec<PreviewState>>>) {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let into = seen.clone();
        let sink = Sink::new(move |event, payload| {
            if event == EVENT {
                into.lock()
                    .unwrap()
                    .push(serde_json::from_value(payload).unwrap());
            }
        });
        (sink, seen)
    }

    fn serve(dir: &str) -> PreviewConfig {
        PreviewConfig {
            directory: dir.into(),
            command: "exec python3 -m http.server {port} --bind 127.0.0.1".into(),
        }
    }

    fn config(command: &str) -> PreviewConfig {
        PreviewConfig {
            directory: String::new(),
            command: command.into(),
        }
    }

    async fn settle(m: &Manager, session: &str, secs: u64) -> PreviewState {
        let deadline = Instant::now() + Duration::from_secs(secs);
        loop {
            let state = m.status(session).expect("no preview");
            if !(state.status == PreviewStatus::Starting) || Instant::now() > deadline {
                return state;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    }

    fn alive(pid: i32) -> bool {
        unsafe { libc::kill(pid, 0) == 0 }
    }

    async fn gone(pid: i32) -> bool {
        for _ in 0..60 {
            if !alive(pid) {
                return true;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        false
    }

    async fn read_pid(file: &Path) -> i32 {
        for _ in 0..100 {
            if let Ok(text) = std::fs::read_to_string(file) {
                if let Ok(pid) = text.trim().parse() {
                    return pid;
                }
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        panic!("{} never written", file.display());
    }

    async fn body(url: &str) -> Option<String> {
        tokio::time::timeout(Duration::from_secs(5), async {
            let addr: SocketAddr = url.strip_prefix("http://")?.parse().ok()?;
            let mut stream = TcpStream::connect(addr).await.ok()?;
            let request = format!("GET / HTTP/1.1\r\nHost: {addr}\r\nConnection: close\r\n\r\n");
            stream.write_all(request.as_bytes()).await.ok()?;
            let mut out = String::new();
            stream.read_to_string(&mut out).await.ok()?;
            Some(out)
        })
        .await
        .ok()
        .flatten()
    }

    #[tokio::test]
    async fn two_worktrees_run_side_by_side() {
        let m = manager(3, quick());
        let (a, b) = (tempdir("a"), tempdir("b"));
        for (dir, marker) in [(&a, "only-in-a.txt"), (&b, "only-in-b.txt")] {
            std::fs::create_dir_all(dir.join("web")).unwrap();
            std::fs::write(dir.join("web").join(marker), "").unwrap();
        }
        m.start(None, "a", &a, serve("./web/")).await.unwrap();
        m.start(None, "b", &b, serve("web")).await.unwrap();
        let (sa, sb) = (settle(&m, "a", 20).await, settle(&m, "b", 20).await);
        assert_eq!(sa.status, PreviewStatus::Running, "{sa:?}\n{}", m.logs("a"));
        assert_eq!(sb.status, PreviewStatus::Running, "{sb:?}\n{}", m.logs("b"));
        assert_ne!(sa.port, sb.port);
        assert_eq!(sa.config.directory, "web");
        assert_eq!(sa.url, Some(format!("http://127.0.0.1:{}", sa.port)));
        let (ba, bb) = (
            body(sa.url.as_deref().unwrap()).await.unwrap(),
            body(sb.url.as_deref().unwrap()).await.unwrap(),
        );
        assert!(ba.contains("only-in-a.txt") && !ba.contains("only-in-b.txt"));
        assert!(bb.contains("only-in-b.txt") && !bb.contains("only-in-a.txt"));
        assert!(m.logs("a").starts_with("$ exec python3"));

        let stopped = m.stop(None, "a").await.unwrap();
        assert_eq!(stopped.status, PreviewStatus::Stopped);
        assert!(
            body(sa.url.as_deref().unwrap()).await.is_none(),
            "a still answers after stop"
        );
        assert!(
            body(sb.url.as_deref().unwrap()).await.is_some(),
            "stopping a took b with it"
        );
        m.stop(None, "b").await;
    }

    #[tokio::test]
    async fn stop_ends_grandchildren() {
        let m = manager(3, quick());
        let dir = tempdir("grand");
        let command =
            "sleep 600 & echo $! > child.pid; python3 -m http.server {port} --bind 127.0.0.1";
        m.start(None, "s", &dir, config(command)).await.unwrap();
        assert_eq!(
            settle(&m, "s", 20).await.status,
            PreviewStatus::Running,
            "{}",
            m.logs("s")
        );
        let child = read_pid(&dir.join("child.pid")).await;
        assert!(alive(child));
        m.stop(None, "s").await;
        assert!(gone(child).await, "grandchild {child} outlived stop");
    }

    #[tokio::test]
    async fn leader_exit_ends_grandchildren() {
        let m = manager(3, quick());
        let dir = tempdir("leader");
        m.start(
            None,
            "s",
            &dir,
            config("sleep 600 & echo $! > child.pid; exit 3"),
        )
        .await
        .unwrap();
        let state = settle(&m, "s", 20).await;
        assert_eq!(state.status, PreviewStatus::Failed);
        let child = read_pid(&dir.join("child.pid")).await;
        assert!(gone(child).await, "grandchild {child} outlived its leader");
    }

    #[tokio::test]
    async fn startup_crash_fails_with_its_log() {
        let m = manager(3, quick());
        let (sink, seen) = recorder();
        let dir = tempdir("crash");
        m.start(
            Some(sink),
            "s",
            &dir,
            config("echo boom-on-port-{port} >&2; exit 7"),
        )
        .await
        .unwrap();
        let state = settle(&m, "s", 20).await;
        assert_eq!(state.status, PreviewStatus::Failed);
        let message = state.message.unwrap();
        assert!(
            message.contains("code 7") && message.contains("before the preview was ready"),
            "{message}"
        );
        let log = m.logs("s");
        assert!(
            log.contains(&format!("boom-on-port-{}", state.port)),
            "{log}"
        );
        assert!(log.contains("[exited with code 7]"), "{log}");
        let statuses: Vec<_> = seen.lock().unwrap().iter().map(|s| s.status).collect();
        assert_eq!(statuses, [PreviewStatus::Starting, PreviewStatus::Failed]);
    }

    /// The port answers HTTP, but from this test process: never adopted.
    #[tokio::test]
    async fn foreign_listener_is_never_adopted() {
        let m = manager(
            3,
            Timing {
                ready_within: Duration::from_secs(3),
                ..quick()
            },
        );
        let (sink, seen) = recorder();
        let dir = tempdir("foreign");
        let started = m
            .start(
                Some(sink),
                "s",
                &dir,
                config("echo $$ > leader.pid; exec sleep 600"),
            )
            .await
            .unwrap();
        let foreign = std::net::TcpListener::bind((Ipv4Addr::LOCALHOST, started.port)).unwrap();
        std::thread::spawn(move || {
            for stream in foreign.incoming().flatten() {
                use std::io::Write;
                let mut stream = stream;
                let _ = stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n");
            }
        });
        let state = settle(&m, "s", 10).await;
        assert_eq!(state.status, PreviewStatus::Failed);
        let message = state.message.unwrap();
        assert!(
            message.contains(&format!("pid {}", std::process::id())),
            "{message}"
        );
        assert!(seen
            .lock()
            .unwrap()
            .iter()
            .all(|s| s.status != PreviewStatus::Running));
        assert!(gone(read_pid(&dir.join("leader.pid")).await).await);
    }

    /// Another process holds the port on IPv4; ours on IPv6 is shown by its
    /// explicit address, never by a `localhost` that could reach the other.
    #[tokio::test]
    async fn explicit_loopback_beside_a_foreign_listener() {
        let m = manager(3, quick());
        let dir = tempdir("v6");
        let command = "sleep 1; exec python3 -m http.server {port} --bind ::1";
        let started = m.start(None, "s", &dir, config(command)).await.unwrap();
        let _foreign = std::net::TcpListener::bind((Ipv4Addr::LOCALHOST, started.port)).unwrap();
        let state = settle(&m, "s", 20).await;
        assert_eq!(
            state.status,
            PreviewStatus::Running,
            "{state:?}\n{}",
            m.logs("s")
        );
        assert_eq!(state.url, Some(format!("http://[::1]:{}", state.port)));
        m.stop(None, "s").await;
    }

    #[tokio::test]
    async fn stop_start_race_leaves_only_the_latest() {
        let m = manager(3, quick());
        let (sink, seen) = recorder();
        let dir = tempdir("race");
        let command = "echo $$ >> pids; exec python3 -m http.server {port} --bind 127.0.0.1";
        m.start(Some(sink), "s", &dir, config(command))
            .await
            .unwrap();
        m.stop(None, "s").await;
        m.start(None, "s", &dir, config(command)).await.unwrap();
        tokio::time::sleep(Duration::from_millis(300)).await;
        m.start(None, "s", &dir, config(command)).await.unwrap();
        m.stop(None, "s").await;
        let last = m.start(None, "s", &dir, config(command)).await.unwrap();

        let state = settle(&m, "s", 20).await;
        assert_eq!(state.status, PreviewStatus::Running, "{}", m.logs("s"));
        assert_eq!(state.port, last.port);
        tokio::time::sleep(Duration::from_millis(500)).await;
        let pids: Vec<i32> = std::fs::read_to_string(dir.join("pids"))
            .unwrap()
            .lines()
            .filter_map(|l| l.trim().parse().ok())
            .collect();
        let mut live = Vec::new();
        for pid in &pids {
            if !gone(*pid).await {
                live.push(*pid);
            }
        }
        assert_eq!(live.len(), 1, "pids {pids:?}, alive {live:?}");
        // Nothing reported after the final run went live came from an older one.
        let after: Vec<_> = seen
            .lock()
            .unwrap()
            .iter()
            .rev()
            .take_while(|s| s.port == last.port)
            .cloned()
            .collect();
        assert_eq!(
            after.first().map(|s| s.status),
            Some(PreviewStatus::Running)
        );
        m.stop(None, "s").await;
        assert!(gone(live[0]).await);
    }

    /// A stop waiting out a TERM-ignoring server must not report `stopped`
    /// after the newer run it overlapped has gone live.
    #[tokio::test]
    async fn slow_stop_never_reports_over_a_newer_run() {
        let m = manager(
            3,
            Timing {
                grace: Duration::from_secs(3),
                ..quick()
            },
        );
        let (sink, seen) = recorder();
        let dir = tempdir("slowstop");
        // An ignored signal survives `exec`, so the server itself shrugs off TERM.
        let stubborn =
            "trap '' TERM; echo $$ > old.pid; exec python3 -m http.server {port} --bind 127.0.0.1";
        m.start(Some(sink), "s", &dir, config(stubborn))
            .await
            .unwrap();
        assert_eq!(
            settle(&m, "s", 20).await.status,
            PreviewStatus::Running,
            "{}",
            m.logs("s")
        );
        let old = read_pid(&dir.join("old.pid")).await;

        let stopping = {
            let m = m.clone();
            tokio::spawn(async move { m.stop(None, "s").await })
        };
        tokio::time::sleep(Duration::from_millis(200)).await;
        assert!(
            alive(old),
            "TERM was not ignored, so the test proves nothing"
        );
        let newer = m.start(None, "s", &dir, serve("")).await.unwrap();
        assert_eq!(settle(&m, "s", 20).await.status, PreviewStatus::Running);
        assert!(
            !stopping.is_finished(),
            "the stop ended before the newer run went live"
        );
        stopping.await.unwrap();
        assert!(gone(old).await, "SIGKILL never reached {old}");

        let last = seen.lock().unwrap().last().cloned().unwrap();
        assert_eq!(
            (last.status, last.port),
            (PreviewStatus::Running, newer.port)
        );
        assert_eq!(m.status("s").unwrap().status, PreviewStatus::Running);
        m.stop(None, "s").await;
    }

    /// What pnpm does: the server moves into a process group of its own.
    const OWN_GROUP: &str = "import os, sys, http.server\n\
        os.setpgrp()\n\
        open('child.pid', 'w').write(str(os.getpid()))\n\
        http.server.ThreadingHTTPServer(('127.0.0.1', int(sys.argv[1])), http.server.SimpleHTTPRequestHandler).serve_forever()\n";

    #[tokio::test]
    async fn a_server_in_its_own_group_is_owned_and_stopped() {
        let m = manager(3, quick());
        let dir = tempdir("owngroup");
        std::fs::write(dir.join("server.py"), OWN_GROUP).unwrap();
        // Not the last command, so the shell stays as the root group's leader.
        let state = m
            .start(
                None,
                "s",
                &dir,
                config("python3 server.py {port}; echo done"),
            )
            .await
            .unwrap();
        let running = settle(&m, "s", 20).await;
        assert_eq!(
            running.status,
            PreviewStatus::Running,
            "{running:?}\n{}",
            m.logs("s")
        );
        let child = read_pid(&dir.join("child.pid")).await;
        assert_eq!(
            unsafe { libc::getpgid(child) },
            child,
            "the server never left the root group"
        );
        assert_eq!(
            running.url,
            Some(format!("http://127.0.0.1:{}", state.port))
        );
        m.stop(None, "s").await;
        assert!(
            gone(child).await,
            "server {child} in its own group outlived stop"
        );
    }

    /// The leader exits after the server has moved groups; only the group
    /// recorded while both lived can still reach it.
    #[tokio::test]
    async fn a_recorded_group_ends_after_its_leader_exits() {
        let m = manager(3, quick());
        let dir = tempdir("leftgroup");
        std::fs::write(dir.join("server.py"), OWN_GROUP).unwrap();
        let command = "python3 server.py {port} & sleep 3; exit 4";
        m.start(None, "s", &dir, config(command)).await.unwrap();
        assert_eq!(
            settle(&m, "s", 20).await.status,
            PreviewStatus::Running,
            "{}",
            m.logs("s")
        );
        let child = read_pid(&dir.join("child.pid")).await;
        for _ in 0..100 {
            if m.status("s").unwrap().status != PreviewStatus::Running {
                break;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        let ended = m.status("s").unwrap();
        assert_eq!(ended.status, PreviewStatus::Failed);
        assert!(ended.message.unwrap().contains("code 4"));
        assert!(gone(child).await, "server {child} outlived its leader");
    }

    /// The captured case: pnpm 11 runs the script from a group of its own.
    /// Skipped where pnpm or node is not installed.
    #[tokio::test]
    async fn a_real_pnpm_script_is_owned_and_stopped() {
        let found = probe("/bin/sh", &["-lc", "command -v pnpm && command -v node"])
            .await
            .is_some_and(|out| out.lines().count() == 2);
        if !found {
            eprintln!("skipped: no pnpm or node");
            return;
        }
        let m = manager(
            3,
            Timing {
                ready_within: Duration::from_secs(40),
                ..quick()
            },
        );
        let dir = tempdir("pnpm");
        std::fs::write(
            dir.join("package.json"),
            r#"{"name":"p","private":true,"scripts":{"dev":"node server.mjs"}}"#,
        )
        .unwrap();
        std::fs::write(
            dir.join("server.mjs"),
            "import http from 'node:http'; import fs from 'node:fs';\n\
             fs.writeFileSync('child.pid', String(process.pid));\n\
             http.createServer((_, res) => res.end('ok')).listen(Number(process.env.PORT), '127.0.0.1');\n",
        )
        .unwrap();
        m.start(None, "s", &dir, config("pnpm run dev"))
            .await
            .unwrap();
        let state = settle(&m, "s", 40).await;
        assert_eq!(
            state.status,
            PreviewStatus::Running,
            "{state:?}\n{}",
            m.logs("s")
        );
        let child = read_pid(&dir.join("child.pid")).await;
        m.stop(None, "s").await;
        assert!(gone(child).await, "node {child} under pnpm outlived stop");
    }

    #[test]
    fn finds_groups_down_the_tree() {
        // 10 is the root group; 11 its child; 12 moved to group 12 and forked
        // 13 into group 13; 20 is unrelated; 14 joined the server's own group, 99.
        let ps = "10 1 10\n11 10 10\n12 11 12\n13 12 13\n14 12 99\n20 1 20\n";
        let found = tree_groups(&parse_ps(ps), &HashSet::from([10]), 99);
        assert_eq!(found, HashSet::from([10, 12, 13]));
        // The root gone, members of a recorded group still lead to the rest.
        let found = tree_groups(
            &parse_ps("12 1 12\n13 12 13\n"),
            &HashSet::from([10, 12]),
            99,
        );
        assert_eq!(found, HashSet::from([10, 12, 13]));
    }

    #[tokio::test]
    async fn fourth_preview_evicts_the_oldest() {
        let m = manager(3, quick());
        let mut leaders = Vec::new();
        for i in 0..4 {
            let dir = tempdir(&format!("evict{i}"));
            let command =
                "echo $$ > leader.pid; exec python3 -m http.server {port} --bind 127.0.0.1";
            m.start(None, &format!("s{i}"), &dir, config(command))
                .await
                .unwrap();
            if i < 3 {
                assert_eq!(
                    settle(&m, &format!("s{i}"), 20).await.status,
                    PreviewStatus::Running
                );
            }
            leaders.push(dir.join("leader.pid"));
        }
        let first = m.status("s0").unwrap();
        assert_eq!(first.status, PreviewStatus::Stopped);
        assert!(first.message.unwrap().contains("make room"));
        assert!(gone(read_pid(&leaders[0]).await).await);
        assert_eq!(settle(&m, "s3", 20).await.status, PreviewStatus::Running);
        for i in 1..4 {
            assert_eq!(
                m.status(&format!("s{i}")).unwrap().status,
                PreviewStatus::Running,
                "s{i}"
            );
            m.stop(None, &format!("s{i}")).await;
        }
    }

    #[tokio::test]
    async fn close_cancels_a_start_in_flight() {
        let m = manager(3, quick());
        let dir = tempdir("close");
        let command = "echo $$ > leader.pid; exec python3 -m http.server {port} --bind 127.0.0.1";
        let started = m.start(None, "s", &dir, config(command)).await.unwrap();
        m.close("s").await;
        assert!(m.status("s").is_none());
        tokio::time::sleep(Duration::from_secs(1)).await;
        if let Ok(text) = std::fs::read_to_string(dir.join("leader.pid")) {
            assert!(
                gone(text.trim().parse().unwrap()).await,
                "a closed start kept running"
            );
        }
        assert!(body(&format!("http://127.0.0.1:{}", started.port))
            .await
            .is_none());
    }

    #[test]
    fn confine_keeps_inside_the_checkout() {
        let root = tempdir("confine");
        std::fs::create_dir_all(root.join("apps/web")).unwrap();
        let outside = tempdir("outside");
        std::os::unix::fs::symlink(&outside, root.join("escape")).unwrap();
        assert_eq!(confine(&root, "").unwrap().0, "");
        assert_eq!(confine(&root, "./apps//web/").unwrap().0, "apps/web");
        for bad in ["..", "apps/../..", "/tmp", "escape", "missing"] {
            assert!(confine(&root, bad).is_err(), "{bad} accepted");
        }
        assert!(prepare(&root, config("  ")).is_err());
    }

    #[test]
    fn suggests_the_package_manager_and_port_flag() {
        let root = tempdir("suggest");
        let web = root.join("apps/web");
        std::fs::create_dir_all(&web).unwrap();
        std::fs::write(root.join("pnpm-lock.yaml"), "").unwrap();
        let write = |scripts: &str| {
            std::fs::write(
                web.join("package.json"),
                format!(r#"{{"scripts":{scripts}}}"#),
            )
            .unwrap()
        };

        write(r#"{"dev":"vite","build":"vite build"}"#);
        assert_eq!(
            suggest(&web, &root),
            "pnpm run dev --port {port} --strictPort"
        );
        write(r#"{"start":"react-scripts start"}"#);
        assert_eq!(suggest(&web, &root), "pnpm run start");
        write(r#"{"dev":"next dev --turbopack"}"#);
        assert_eq!(suggest(&web, &root), "pnpm run dev -p {port}");
        write(r#"{"dev":"tsc -w && vite"}"#);
        assert_eq!(suggest(&web, &root), "pnpm run dev");
        write(r#"{"dev":"turbo run dev"}"#);
        assert_eq!(suggest(&web, &root), "pnpm run dev");

        std::fs::remove_file(root.join("pnpm-lock.yaml")).unwrap();
        write(r#"{"dev":"astro dev"}"#);
        assert_eq!(suggest(&web, &root), "npm run dev -- --port {port}");
        std::fs::write(web.join("yarn.lock"), "").unwrap();
        assert_eq!(suggest(&web, &root), "yarn run dev --port {port}");
        std::fs::write(
            web.join("package.json"),
            r#"{"packageManager":"bun@1.2.0","scripts":{"dev":"vite"}}"#,
        )
        .unwrap();
        assert_eq!(
            suggest(&web, &root),
            "bun run dev --port {port} --strictPort"
        );
        write(r#"{"build":"tsc"}"#);
        assert_eq!(suggest(&web, &root), "");
        assert_eq!(suggest(&root, &root), "");
    }

    #[tokio::test]
    async fn config_is_saved_per_project() {
        let path = tempdir("config").join(CONFIG_FILE);
        let web = PreviewConfig {
            directory: "apps/web".into(),
            command: "pnpm dev".into(),
        };
        write_config(&path, "/x/one", &web).await.unwrap();
        write_config(&path, "/x/two", &config("npm start"))
            .await
            .unwrap();
        write_config(&path, "/x/one", &config("bun dev"))
            .await
            .unwrap();
        let all = read_configs(&path).await.unwrap();
        assert_eq!(all["/x/one"], config("bun dev"));
        assert_eq!(all["/x/two"], config("npm start"));
        assert!(read_configs(&path.with_file_name("none.json"))
            .await
            .unwrap()
            .is_empty());
    }

    #[test]
    fn log_keeps_the_last_64k() {
        let mut log = Log::default();
        log.push("é".repeat(LOG_LIMIT).as_bytes());
        log.push(b"tail");
        assert_eq!(log.buf.len(), LOG_LIMIT);
        let text = log.text();
        assert!(text.ends_with("tail") && !text.contains('\u{FFFD}'));
    }

    #[test]
    fn parses_lsof_listeners() {
        let text = "p10\ng10\ncnode\nf20\ntIPv6\nn[::1]:3000\np11\ng99\ncpython\nf3\ntIPv4\nn127.0.0.1:3000\nf4\ntIPv6\nn*:3000\nf5\ntIPv4\nn10.0.0.2:3000\n";
        let found = parse_lsof(text, 3000);
        assert_eq!(
            found[0],
            Listener {
                pid: 10,
                pgid: 10,
                name: "node".into(),
                v4: false,
                v6: true
            }
        );
        assert_eq!((found[1].pgid, found[1].v4, found[1].v6), (99, true, false));
        assert_eq!((found[2].v4, found[2].v6), (true, true));
        assert_eq!((found[3].v4, found[3].v6), (false, false));
        assert!(parse_lsof(text, 3001).is_empty());
    }

    #[test]
    fn parses_proc_net_listeners() {
        let v4 = "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode\n   \
            0: 0100007F:0BB8 00000000:0000 0A 00000000:00000000 00:00000000 00000000   501        0 111 1 0 100 0 0 10 0\n   \
            1: 0500000A:0BB8 00000000:0000 0A 00000000:00000000 00:00000000 00000000   501        0 222 1 0 100 0 0 10 0\n   \
            2: 0100007F:0BB8 0100007F:D431 01 00000000:00000000 00:00000000 00000000   501        0 333 1 0 100 0 0 10 0\n";
        assert_eq!(parse_proc_net(v4, false, 3000), vec![(111, true, false)]);
        let v6 = "  sl  local_address remote_address st tx_queue rx_queue tr tm->when retrnsmt uid timeout inode\n   \
            0: 00000000000000000000000000000000:0BB8 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000 501 0 555 1\n";
        assert_eq!(parse_proc_net(v6, true, 3000), vec![(555, true, true)]);
        assert_eq!(
            stat_parents("42 (we ird) cmd) S 1 4242 4242 0"),
            Some((1, 4242))
        );
    }

    #[test]
    fn judges_ownership() {
        let l = |pgid, v4, v6| Listener {
            pid: pgid as u32,
            pgid,
            name: "x".into(),
            v4,
            v6,
        };
        assert_eq!(judge(&[], &HashSet::from([5]), 80), Verdict::Wait(None));
        assert_eq!(
            judge(&[l(9, true, false)], &HashSet::from([5]), 80),
            Verdict::Wait(Some("x (pid 9)".into()))
        );
        assert_eq!(
            judge(&[l(5, true, true)], &HashSet::from([5]), 80),
            Verdict::Ready("127.0.0.1:80".parse().unwrap())
        );
        assert_eq!(
            judge(
                &[l(5, true, true), l(9, true, false)],
                &HashSet::from([5]),
                80
            ),
            Verdict::Ready("[::1]:80".parse().unwrap())
        );
        assert!(matches!(
            judge(
                &[l(5, true, false), l(9, true, true)],
                &HashSet::from([5]),
                80
            ),
            Verdict::Conflict(_)
        ));
    }
}
