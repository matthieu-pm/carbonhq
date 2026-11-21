use std::collections::VecDeque;
use std::io::{Read, Write};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::Duration;

use anyhow::{anyhow, ensure, Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tokio::sync::watch;
use uuid::Uuid;

const HISTORY: usize = 512 * 1024;
const CHUNK: usize = 32 * 1024;
static LIFECYCLE: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
static TABS: LazyLock<Mutex<Vec<Arc<Tab>>>> = LazyLock::new(Mutex::default);

#[derive(Clone, Serialize)]
pub(crate) struct TabInfo {
    id: Uuid,
    number: usize,
}

struct Tab {
    info: TabInfo,
    owner: Uuid,
    session: String,
    master: Mutex<Box<dyn MasterPty + Send>>,
    input: Mutex<Box<dyn Write + Send>>,
    child: Mutex<Box<dyn Child + Send + Sync>>,
    output: watch::Sender<Output>,
}

#[derive(Default)]
struct Output {
    bytes: VecDeque<u8>,
    end: u64,
    exited: bool,
}

#[derive(Serialize)]
pub(crate) struct Frame {
    end: u64,
    start: u64,
    data: String,
    exited: bool,
}

impl Output {
    fn append(&mut self, bytes: &[u8]) {
        self.end += bytes.len() as u64;
        self.bytes.extend(bytes);
        self.bytes.drain(..self.bytes.len().saturating_sub(HISTORY));
    }

    fn frame(&self, offset: u64) -> Frame {
        let oldest = self.end - self.bytes.len() as u64;
        let start = offset.clamp(oldest, self.end);
        let bytes: Vec<_> = self
            .bytes
            .iter()
            .skip((start - oldest) as usize)
            .take(CHUNK)
            .copied()
            .collect();
        Frame {
            end: self.end,
            start,
            exited: self.exited && start + bytes.len() as u64 == self.end,
            data: STANDARD.encode(bytes),
        }
    }
}

fn size(cols: u16, rows: u16) -> PtySize {
    PtySize {
        cols: cols.max(2),
        rows: rows.max(1),
        pixel_width: 0,
        pixel_height: 0,
    }
}

impl Tab {
    fn spawn(info: TabInfo, owner: Uuid, session: String, cwd: &str) -> Result<Arc<Self>> {
        ensure!(
            std::path::Path::new(cwd).is_dir(),
            "The session working directory is unavailable."
        );
        let pair = native_pty_system().openpty(size(80, 24))?;
        let mut reader = pair.master.try_clone_reader()?;
        let input = pair.master.take_writer()?;
        let mut command = CommandBuilder::new_default_prog();
        command.cwd(cwd);
        command.env("TERM", "xterm-256color");
        let child = pair
            .slave
            .spawn_command(command)
            .context("Could not start the session shell")?;
        drop(pair.slave);
        let tab = Arc::new(Self {
            info,
            owner,
            session,
            master: Mutex::new(pair.master),
            input: Mutex::new(input),
            child: Mutex::new(child),
            output: watch::channel(Output::default()).0,
        });
        let shell = tab.clone();
        std::thread::spawn(move || {
            let mut buf = [0; 8192];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => shell.output.send_modify(|out| out.append(&buf[..n])),
                    Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
                    Err(_) => break,
                }
            }
            shell.output.send_modify(|out| out.exited = true);
            while matches!(shell.child.lock().unwrap().try_wait(), Ok(None)) {
                std::thread::sleep(Duration::from_millis(100));
            }
        });
        Ok(tab)
    }

    fn stop(&self) -> Result<()> {
        let mut child = self.child.lock().unwrap();
        if child.try_wait()?.is_none() {
            if let Some(pid) = child.process_id() {
                crate::local_servers::kill_descendants_blocking(pid);
            }
            child.kill()?;
            child.wait()?;
        }
        Ok(())
    }
}

fn find(owner: Uuid, session: &str, id: Uuid) -> Result<Arc<Tab>> {
    TABS.lock()
        .unwrap()
        .iter()
        .find(|t| t.owner == owner && t.session == session && t.info.id == id)
        .cloned()
        .context("Terminal tab closed.")
}

/// Reopening the pane attaches to its existing shells. A retried + has the same request id.
pub(crate) async fn open(
    owner: Uuid,
    session: String,
    id: Uuid,
    additional: bool,
) -> Result<Vec<TabInfo>, crate::Fail> {
    let _opening = crate::session::Sending::enter().await;
    let _lifecycle = LIFECYCLE.lock().await;
    let row = crate::store::get_session_index_item(&session)
        .await?
        .context("Session no longer exists.")?;
    tokio::task::spawn_blocking(move || {
        let mut tabs = TABS.lock().unwrap();
        let mut list: Vec<_> = tabs
            .iter()
            .filter(|t| t.owner == owner && t.session == session)
            .map(|t| t.info.clone())
            .collect();
        if list.is_empty() || (additional && !list.iter().any(|t| t.id == id)) {
            let info = TabInfo {
                id,
                number: list.last().map_or(1, |t| t.number + 1),
            };
            tabs.push(Tab::spawn(info.clone(), owner, session, &row.cwd)?);
            list.push(info);
        }
        Ok::<_, anyhow::Error>(list)
    })
    .await
    .map_err(|e| anyhow!(e))?
    .map_err(Into::into)
}

/// Reads retained bytes by offset, waiting for output only when caught up.
pub(crate) async fn read(
    owner: Uuid,
    session: &str,
    id: Uuid,
    offset: u64,
    wait: bool,
) -> Result<Frame, crate::Fail> {
    let mut output = find(owner, session, id)?.output.subscribe();
    if wait {
        let _ = tokio::time::timeout(
            Duration::from_secs(5),
            output.wait_for(|o| o.end != offset || o.exited),
        )
        .await;
    }
    let frame = output.borrow().frame(offset);
    Ok(frame)
}

pub(crate) async fn write(
    owner: Uuid,
    session: &str,
    id: Uuid,
    data: String,
) -> Result<(), crate::Fail> {
    let tab = find(owner, session, id)?;
    tokio::task::spawn_blocking(move || tab.input.lock().unwrap().write_all(data.as_bytes()))
        .await
        .map_err(|e| anyhow!(e))?
        .context("Could not write to terminal")?;
    Ok(())
}

pub(crate) fn resize(
    owner: Uuid,
    session: &str,
    id: Uuid,
    cols: u16,
    rows: u16,
) -> Result<(), crate::Fail> {
    find(owner, session, id)?
        .master
        .lock()
        .unwrap()
        .resize(size(cols, rows))?;
    Ok(())
}

pub(crate) async fn close(
    matching: impl Fn(&TabKey) -> bool + Send + 'static,
) -> Result<(), crate::Fail> {
    let _lifecycle = LIFECYCLE.lock().await;
    tokio::task::spawn_blocking(move || {
        let mut tabs = TABS.lock().unwrap();
        let mut i = 0;
        while i < tabs.len() {
            let tab = &tabs[i];
            if matching(&TabKey {
                owner: tab.owner,
                session: &tab.session,
                id: tab.info.id,
            }) {
                tab.stop()?;
                tabs.remove(i);
            } else {
                i += 1;
            }
        }
        Ok::<_, anyhow::Error>(())
    })
    .await
    .map_err(|e| anyhow!(e))?
    .map_err(Into::into)
}

pub(crate) struct TabKey<'a> {
    pub owner: Uuid,
    pub session: &'a str,
    pub id: Uuid,
}

pub(crate) fn has_running() -> bool {
    TABS.lock()
        .unwrap()
        .iter()
        .any(|t| !t.output.borrow().exited)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replay_reports_a_gap_and_delivers_the_final_bytes_before_exit() {
        let mut out = Output::default();
        out.append(&vec![b'x'; HISTORY]);
        out.append(b"hello");
        out.exited = true;
        let first = out.frame(0);
        assert_eq!(first.start, 5);
        assert!(!first.exited);
        let last = out.frame(HISTORY as u64);
        assert_eq!(STANDARD.decode(last.data).unwrap(), b"hello");
        assert!(last.exited);
    }

    #[tokio::test]
    async fn pty_input_output_resize_and_close_are_scoped_to_the_owner_and_session() {
        let owner = Uuid::new_v4();
        let id = Uuid::new_v4();
        let session = id.to_string();
        let tab = Tab::spawn(TabInfo { id, number: 1 }, owner, session.clone(), "/").unwrap();
        TABS.lock().unwrap().push(tab);
        assert!(find(Uuid::new_v4(), &session, id).is_err());
        assert!(find(owner, "other", id).is_err());
        resize(owner, &session, id, 91, 32).unwrap();
        write(
            owner,
            &session,
            id,
            "stty size; pwd; printf 'shell-%s\\n' ready\n".into(),
        )
        .await
        .unwrap();
        let output = tokio::time::timeout(Duration::from_secs(8), async {
            let mut text = Vec::new();
            loop {
                let frame = read(owner, &session, id, text.len() as u64, true)
                    .await
                    .unwrap();
                text.extend(STANDARD.decode(frame.data).unwrap());
                if String::from_utf8_lossy(&text).contains("shell-ready") {
                    break text;
                }
            }
        })
        .await;
        close(move |t| t.id == id).await.unwrap();
        let text = String::from_utf8(output.unwrap()).unwrap();
        assert!(text.contains("32 91"));
        assert!(text.contains("\r\n/\r\n"));
        assert!(find(owner, &session, id).is_err());
    }
}
