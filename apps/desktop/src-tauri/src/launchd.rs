//! The login agent that runs the Mac's background server: this app's own
//! binary with `--serve`, started by launchd at login and kept alive through
//! app quits and crashes. The app installs it on every launch. See
//! MAC-SERVER-PLAN.md.

use std::path::PathBuf;

use anyhow::{bail, Context, Result};
use tokio::process::Command;

/// A dev build gets its own agent, running the binary cargo just built on
/// `~/.carbon-dev`, so it never replaces the release app's server.
fn label() -> &'static str {
    if crate::is_dev() { "com.yogesh.carbon.server.dev" } else { "com.yogesh.carbon.server" }
}

fn target() -> String {
    format!("gui/{}/{}", unsafe { libc::getuid() }, label())
}

const LEGACY_LABEL: &str = "com.yogesh.carbon-serve";

fn legacy_target() -> String {
    format!("gui/{}/{}", unsafe { libc::getuid() }, LEGACY_LABEL)
}

fn plist_path() -> Result<PathBuf> {
    let home = std::env::home_dir().context("no home directory")?;
    Ok(home.join("Library/LaunchAgents").join(format!("{}.plist", label())))
}

fn escape(text: &str) -> String {
    text.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

/// `Interactive` because the server is the app's own backend: agents run
/// builds under it, and the default applies the light throttling launchd
/// gives background jobs.
///
/// `env` is what the app was started with that the server must share:
/// launchd starts it with its own environment, so `CARBON_HOME` would put it
/// under another home and `CARBON_NO_ANALYTICS` would be lost.
fn plist(exe: &str, log: &str, env: &[(&str, String)]) -> Result<String> {
    check_server_path(std::path::Path::new(exe))?;
    let (label, exe, log) = (label(), escape(exe), escape(log));
    let pairs: String = env.iter().map(|(k, v)| format!("<key>{k}</key><string>{}</string>", escape(v))).collect();
    let env = if pairs.is_empty() {
        String::new()
    } else {
        format!("\n  <key>EnvironmentVariables</key><dict>{pairs}</dict>")
    };
    Ok(format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>{label}</string>
  <key>ProgramArguments</key><array><string>{exe}</string><string>--serve</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Interactive</string>
  <key>StandardOutPath</key><string>{log}</string>
  <key>StandardErrorPath</key><string>{log}</string>{env}
</dict>
</plist>
"#
    ))
}

async fn launchctl(args: &[&str]) -> Result<std::process::Output> {
    Command::new("/bin/launchctl").args(args).output().await.context("could not run launchctl")
}

/// A plist newer than the job launchd has loaded, held back until that job's
/// server has gone idle. Kept out of the file meanwhile, so the file always
/// names the loaded job and a quit before the reload loses nothing: the next
/// launch finds the same difference.
static PENDING: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);

#[derive(Debug, PartialEq)]
enum InstallAction {
    Keep,
    WaitForIdle,
    Replace,
}

/// Only a live server sharing this home needs to finish its turns before its job changes.
fn install_action(loaded: bool, running: bool, on_disk: Option<&str>, wanted: &str) -> InstallAction {
    if loaded && on_disk == Some(wanted) {
        InstallAction::Keep
    } else if loaded && running && on_disk.map(home_dir) == Some(home_dir(wanted)) {
        InstallAction::WaitForIdle
    } else {
        InstallAction::Replace
    }
}

/// Temporary mounts and Gatekeeper's relocated copies disappear after install or eject.
fn check_server_path(exe: &std::path::Path) -> Result<()> {
    if exe.starts_with("/Volumes") || exe.components().any(|part| part.as_os_str() == "AppTranslocation") {
        bail!("Move Carbon to your Applications folder, then open it there. Carbon cannot start its background server from a disk image or a temporary macOS location.");
    }
    Ok(())
}

/// Stops a temporary copy before it can install CLI links or replace the login agent.
pub fn check_install_location() -> Result<()> {
    if !crate::is_dev() {
        check_server_path(&std::env::current_exe().context("no path to this binary")?)?;
    }
    Ok(())
}

/// A loaded job can be waiting on a missing executable, so success alone does not mean a server exists.
fn job_has_pid(output: &[u8]) -> bool {
    String::from_utf8_lossy(output).lines().any(|line| {
        line.trim().strip_prefix("pid = ").and_then(|pid| pid.parse::<u32>().ok()).is_some_and(|pid| pid > 0)
    })
}

/// Installs the agent, or points it at this binary and environment where it
/// names others — Carbon.app moved, a second copy opened, `CARBON_NO_ANALYTICS`
/// changed. Unloading a job stops every turn under it, so a running server
/// keeps its job until the app's `restart_when_idle` lets it go, and
/// [`reload_if_pending`] loads the new one then. A changed `CARBON_HOME` is the
/// exception and moves at once: that server keeps its port in the other home,
/// so the app could never reach it to ask.
pub async fn ensure() -> Result<()> {
    let exe = std::env::current_exe().context("no path to this binary")?;
    let log = crate::store::get_home_app_dir().await?.join(crate::serve::SERVER_LOG);
    if crate::is_dev() {
        return spawn_dev(&exe, &log);
    }
    let env: Vec<(&str, String)> = ["CARBON_HOME", "CARBON_NO_ANALYTICS"]
        .into_iter()
        .filter_map(|k| std::env::var(k).ok().filter(|v| !v.is_empty()).map(|v| (k, v)))
        .collect();
    let wanted = plist(&exe.to_string_lossy(), &log.to_string_lossy(), &env)?;
    let path = plist_path()?;
    let job = launchctl(&["print", &target()]).await?;
    let loaded = job.status.success();
    let on_disk = tokio::fs::read_to_string(&path).await.ok();
    if legacy_job(&wanted).await?.is_some() {
        *PENDING.lock().unwrap_or_else(|e| e.into_inner()) = Some(wanted);
        return install_pending(loaded).await;
    }
    match install_action(loaded, job_has_pid(&job.stdout), on_disk.as_deref(), &wanted) {
        InstallAction::Keep => Ok(()),
        InstallAction::WaitForIdle => {
            *PENDING.lock().unwrap_or_else(|e| e.into_inner()) = Some(wanted);
            Ok(())
        }
        InstallAction::Replace => {
            *PENDING.lock().unwrap_or_else(|e| e.into_inner()) = Some(wanted);
            install_pending(loaded).await
        }
    }
}

/// The `CARBON_HOME` a plist [`plist`] wrote names, if any.
fn home_of(plist: &str) -> Option<&str> {
    let (_, rest) = plist.split_once("<key>CARBON_HOME</key><string>")?;
    rest.split_once("</string>").map(|(home, _)| home)
}

/// The directory a plist's server uses, resolved: no `CARBON_HOME` and one
/// naming `~/.carbon` are one home, and moving between them must not restart.
fn home_dir(plist: &str) -> Option<PathBuf> {
    let home = home_of(plist).map(|home| home.replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&"));
    resolve_home(home.as_deref())
}

fn resolve_home(home: Option<&str>) -> Option<PathBuf> {
    let home = match home.filter(|home| !home.is_empty()) {
        Some(home) => PathBuf::from(home),
        None => std::env::home_dir()?.join(".carbon"),
    };
    Some(std::fs::canonicalize(&home).unwrap_or(home))
}

/// A separately configured headless home belongs to its CLI, even on a Mac with the app installed.
fn legacy_home(config: &serde_json::Value) -> Result<Option<PathBuf>> {
    let home = config.get("EnvironmentVariables").and_then(|env| env.get("CARBON_HOME"));
    match home {
        None => Ok(resolve_home(None)),
        Some(serde_json::Value::String(home)) => Ok(resolve_home(Some(home))),
        Some(_) => bail!("the old Carbon server has an invalid CARBON_HOME"),
    }
}

/// Only the old CLI job sharing this profile competes with the app's server.
async fn legacy_job(wanted: &str) -> Result<Option<std::process::Output>> {
    let path = std::env::home_dir().context("no home directory")?
        .join("Library/LaunchAgents").join(format!("{LEGACY_LABEL}.plist"));
    if !path.exists() {
        return Ok(None);
    }
    let out = Command::new("/usr/bin/plutil").args(["-convert", "json", "-o", "-", &path.to_string_lossy()]).output().await?;
    if !out.status.success() {
        bail!("could not read the old Carbon server's login job");
    }
    let config = serde_json::from_slice(&out.stdout)?;
    if legacy_home(&config)? != home_dir(wanted) {
        return Ok(None);
    }
    Ok(Some(launchctl(&["print", &legacy_target()]).await?))
}

/// Called under the server's lock, so a legacy job cannot accept a turn between its idle exit and bootout.
async fn retire_legacy(wanted: &str) -> Result<bool> {
    if legacy_job(wanted).await?.is_none() {
        return Ok(true);
    }
    let home = home_dir(wanted).context("no Carbon home")?;
    let job = launchctl(&["print", &legacy_target()]).await?;
    if job.status.success() && job_has_pid(&job.stdout) {
        return Ok(false);
    }
    let _ = launchctl(&["bootout", &legacy_target()]).await?;
    if launchctl(&["print", &legacy_target()]).await?.status.success() {
        bail!("the old Carbon server's login job has not unloaded yet");
    }
    let path = std::env::home_dir().context("no home directory")?
        .join("Library/LaunchAgents").join(format!("{LEGACY_LABEL}.plist"));
    let backups = home.join("retired-login-agents");
    tokio::fs::create_dir_all(&backups).await?;
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)?.as_nanos();
    tokio::fs::rename(path, backups.join(format!("{LEGACY_LABEL}-{stamp}.plist"))).await?;
    Ok(true)
}

/// A lost connection is not proof of an idle exit; only the server releasing its lifetime lock is.
fn try_server_lock(home: &std::path::Path) -> Result<Option<std::fs::File>> {
    let held = std::fs::OpenOptions::new().create(true).truncate(false).write(true).open(home.join("serve.lock"))?;
    if unsafe { libc::flock(std::os::fd::AsRawFd::as_raw_fd(&held), libc::LOCK_EX | libc::LOCK_NB) } != 0 {
        let error = std::io::Error::last_os_error();
        if error.kind() == std::io::ErrorKind::WouldBlock {
            return Ok(None);
        }
        return Err(error).context("could not check the Carbon server's lock");
    }
    Ok(Some(held))
}

/// Whether the server running now was started from an older plist.
pub fn reload_pending() -> bool {
    PENDING.lock().unwrap_or_else(|e| e.into_inner()).is_some()
}

/// Loads the plist [`ensure`] held back, once the old server has exited.
/// launchd may have started it again from the old job by then; that one is
/// fresh and idle, and goes with the job.
pub async fn reload_if_pending() -> Result<()> {
    install_pending(true).await
}

/// Keep the desired job queued if launchd is still unloading the old one or temporarily refuses bootstrap.
async fn install_pending(loaded: bool) -> Result<()> {
    let Some(wanted) = PENDING.lock().unwrap_or_else(|e| e.into_inner()).clone() else {
        return Ok(());
    };
    let home = home_dir(&wanted).context("no Carbon home")?;
    let Some(held) = try_server_lock(&home)? else {
        return Ok(());
    };
    if !retire_legacy(&wanted).await? {
        return Ok(());
    }
    install(&plist_path()?, &wanted, loaded, held).await?;
    let mut pending = PENDING.lock().unwrap_or_else(|e| e.into_inner());
    if pending.as_ref() == Some(&wanted) {
        *pending = None;
    }
    Ok(())
}

/// An old job with no process cannot answer `restart_when_idle`; replace it without stopping a live server.
pub async fn recover_if_stopped() -> Result<()> {
    if reload_pending() {
        let job = launchctl(&["print", &target()]).await?;
        if !job.status.success() || !job_has_pid(&job.stdout) {
            reload_if_pending().await?;
        }
    }
    Ok(())
}

async fn install(path: &std::path::Path, wanted: &str, loaded: bool, held: std::fs::File) -> Result<()> {
    if let Some(dir) = path.parent() {
        tokio::fs::create_dir_all(dir).await?;
    }
    tokio::fs::write(path, wanted).await.with_context(|| format!("could not write {}", path.display()))?;
    if loaded {
        let _ = launchctl(&["bootout", &target()]).await;
    }
    drop(held);
    bootstrap(path).await
}

async fn bootstrap(path: &std::path::Path) -> Result<()> {
    let domain = format!("gui/{}", unsafe { libc::getuid() });
    let out = launchctl(&["bootstrap", &domain, &path.to_string_lossy()]).await?;
    if !out.status.success() {
        bail!("launchctl bootstrap: {}", String::from_utf8_lossy(&out.stderr).trim());
    }
    Ok(())
}

/// A dev build starts its server as a child rather than through launchd. TCC
/// judges a launchd job on its own code identity, and an unsigned binary cargo
/// just rebuilt is a new identity every time, so each rebuild asked for
/// Documents access again and blocked the server in dyld until answered. A
/// child is attributed to the app that started it, which already has access.
/// Cost: nothing restarts a dev server that dies, until the app asks again.
/// A second one exits on its own when the socket already answers, so asking
/// while one runs costs a spawn.
/// Set by [`stop`], or the reconnect loop would start a dev server again in
/// the moment between it stopping and the app exiting.
static STOPPED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

fn spawn_dev(exe: &std::path::Path, log: &std::path::Path) -> Result<()> {
    use std::sync::Mutex;
    use std::time::{Duration, Instant};
    static LAST: Mutex<Option<Instant>> = Mutex::new(None);
    let mut last = LAST.lock().unwrap();
    if STOPPED.load(std::sync::atomic::Ordering::Relaxed) || last.is_some_and(|at| at.elapsed() < Duration::from_secs(5)) {
        return Ok(());
    }
    *last = Some(Instant::now());
    let out = std::fs::OpenOptions::new().create(true).append(true).open(log)?;
    // Its own process group, so Ctrl-C on `pnpm tauri dev` leaves it running
    // the way quitting the release app does.
    Command::new(exe)
        .arg("--serve")
        .stdin(std::process::Stdio::null())
        .stdout(out.try_clone()?)
        .stderr(out)
        .process_group(0)
        .spawn()
        .context("could not start the dev server")?;
    Ok(())
}

/// Stops the server and keeps it stopped until the agent is loaded again —
/// the next launch of the app, or the next login. A dev server has no agent,
/// so it is signalled by the pid it wrote beside its port.
pub async fn stop() -> Result<()> {
    if crate::is_dev() {
        let home = crate::store::get_home_app_dir().await?;
        let written = tokio::fs::read_to_string(home.join(crate::serve::PORT_FILE)).await?;
        let pid: i32 = written.lines().nth(2).and_then(|l| l.trim().parse().ok()).context("no pid in serve-port")?;
        STOPPED.store(true, std::sync::atomic::Ordering::Relaxed);
        unsafe { libc::kill(pid, libc::SIGTERM) };
        return Ok(());
    }
    launchctl(&["bootout", &target()]).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_live_server_lock_blocks_replacing_its_job() {
        let home = std::env::temp_dir().join(format!("carbon-server-lock-{}", uuid::Uuid::now_v7()));
        std::fs::create_dir(&home).unwrap();
        let held = try_server_lock(&home).unwrap().unwrap();
        assert!(try_server_lock(&home).unwrap().is_none());
        drop(held);
        assert!(try_server_lock(&home).unwrap().is_some());
        std::fs::remove_dir_all(home).unwrap();
    }

    #[test]
    fn a_headless_server_on_its_own_home_is_not_migrated() {
        let default = legacy_home(&serde_json::json!({})).unwrap();
        assert_eq!(default, home_dir(""));
        let own = serde_json::json!({"EnvironmentVariables": {"CARBON_HOME": "/tmp/carbon-headless-own-home"}});
        assert_ne!(legacy_home(&own).unwrap(), default);
        assert_eq!(legacy_home(&own).unwrap(), resolve_home(Some("/tmp/carbon-headless-own-home")));
        assert!(legacy_home(&serde_json::json!({"EnvironmentVariables": {"CARBON_HOME": 7}})).is_err());
        let escaped = plist("/Applications/Carbon.app/Contents/MacOS/carbon", "/tmp/log", &[("CARBON_HOME", "/tmp/A & B".into())]).unwrap();
        assert_eq!(home_dir(&escaped), resolve_home(Some("/tmp/A & B")));
    }

    #[test]
    fn a_stopped_old_job_does_not_wait_for_an_unreachable_server() {
        let old = plist("/Applications/Old Carbon.app/Contents/MacOS/carbon", "/tmp/server.log", &[]).unwrap();
        let wanted = plist("/Applications/Carbon.app/Contents/MacOS/carbon", "/tmp/server.log", &[]).unwrap();
        assert_eq!(install_action(true, false, Some(&old), &wanted), InstallAction::Replace);
        assert_eq!(install_action(true, true, Some(&old), &wanted), InstallAction::WaitForIdle);
        assert_eq!(install_action(true, true, Some(&wanted), &wanted), InstallAction::Keep);
        assert_eq!(install_action(false, false, Some(&wanted), &wanted), InstallAction::Replace);
    }

    #[test]
    fn temporary_launch_paths_cannot_become_login_jobs() {
        for exe in [
            "/Volumes/Carbon/Carbon.app/Contents/MacOS/carbon",
            "/Volumes/dmg.j6cIFm/Carbon.app/Contents/MacOS/carbon",
            "/private/var/folders/test/AppTranslocation/uuid/d/Carbon.app/Contents/MacOS/carbon",
        ] {
            assert!(plist(exe, "/tmp/server.log", &[]).is_err(), "registered {exe}");
        }
    }

    #[test]
    fn only_a_current_pid_means_the_job_is_running() {
        assert!(job_has_pid(b"state = running\n\tpid = 80878\n"));
        assert!(!job_has_pid(b"state = spawn scheduled\n\tlast exit code = 78\n"));
        assert!(!job_has_pid(b"pid = 0\n"));
        assert!(!job_has_pid(b"last pid = 80878\n"));
    }

    #[test]
    fn the_plist_runs_this_binary_as_the_server() {
        let text = plist("/Applications/A & B.app/Contents/MacOS/carbon", "/Users/me/.carbon/server.log", &[]).unwrap();
        assert!(text.contains("<string>/Applications/A &amp; B.app/Contents/MacOS/carbon</string><string>--serve</string>"));
        assert!(text.contains("<key>KeepAlive</key><true/>"));
        assert!(text.contains(label()));
        assert!(!text.contains("CARBON_HOME"));
        let homed = plist("/x/carbon", "/h/server.log", &[("CARBON_HOME", "/h".into()), ("CARBON_NO_ANALYTICS", "1".into())]).unwrap();
        assert!(homed.contains("<dict><key>CARBON_HOME</key><string>/h</string><key>CARBON_NO_ANALYTICS</key><string>1</string></dict>"));
        assert_eq!(home_of(&homed), Some("/h"));
        assert_eq!(home_of(&text), None);
    }
}
