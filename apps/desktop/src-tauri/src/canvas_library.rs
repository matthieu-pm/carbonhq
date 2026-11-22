use std::fs::{self, File};
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};

use anyhow::{bail, ensure, Context, Result};
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

const EXT: &str = ".canvas.json";
const ARCHIVE: &str = ".archive";
static WRITES: Mutex<()> = Mutex::const_new(());

#[derive(Default, Serialize)]
pub(crate) struct Library {
    folders: Vec<String>,
    canvases: Vec<Entry>,
}

impl Library {
    /// Search the chosen folder and its descendants using the names shown in the library.
    pub(crate) fn matching(mut self, archived: bool, folder: &str, query: &str) -> Self {
        let needle = query.to_lowercase();
        let prefix = format!("{folder}/");
        let within = |path: &str| folder.is_empty() || path == folder || path.starts_with(&prefix);
        self.canvases.retain(|entry| {
            entry.archived == archived
                && within(&entry.folder)
                && format!("{} {}", entry.folder, entry.name)
                    .to_lowercase()
                    .contains(&needle)
        });
        self.folders.retain(|path| {
            !archived && within(path) && path != folder && path.to_lowercase().contains(&needle)
        });
        self
    }
}

#[derive(Serialize)]
struct Entry {
    folder: String,
    name: String,
    modified: u64,
    archived: bool,
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum Action {
    Create {
        folder: String,
    },
    Folder {
        folder: String,
        name: String,
    },
    Move {
        folder: String,
        name: String,
        destination: String,
    },
    Archive {
        folder: String,
        name: String,
    },
    Restore {
        folder: String,
        name: String,
    },
}

fn check_name(name: &str) -> Result<()> {
    ensure!(
        !name.trim().is_empty()
            && !name.starts_with('.')
            && !name.contains(['/', '\\', ':'])
            && !name.chars().any(char::is_control),
        "Invalid canvas or folder name"
    );
    Ok(())
}

/// Check each directory before descending, including the library root and archive.
fn directory(parent: &Path, name: &str, create: bool) -> Result<PathBuf> {
    let path = parent.join(name);
    if create {
        match fs::create_dir(&path) {
            Ok(()) => (),
            Err(e) if e.kind() == ErrorKind::AlreadyExists => (),
            Err(e) => return Err(e.into()),
        }
    }
    ensure!(
        path.symlink_metadata()?.is_dir(),
        "{} is not a canvas directory",
        path.display()
    );
    Ok(path)
}

fn folder_path(root: &Path, folder: &str, create: bool) -> Result<PathBuf> {
    let mut path = root.to_owned();
    if !folder.is_empty() {
        for part in folder.split('/') {
            check_name(part)?;
            path = directory(&path, part, create)?;
        }
    }
    Ok(path)
}

fn scan(root: &Path, archived: bool, library: &mut Library) -> Result<()> {
    let mut pending = vec![(root.to_owned(), String::new())];
    while let Some((dir, folder)) = pending.pop() {
        for entry in fs::read_dir(dir)? {
            let entry = entry?;
            let Some(filename) = entry.file_name().to_str().map(str::to_owned) else {
                continue;
            };
            if filename.starts_with('.') {
                continue;
            }
            let kind = entry.file_type()?;
            if kind.is_dir() {
                let child = if folder.is_empty() {
                    filename
                } else {
                    format!("{folder}/{filename}")
                };
                if !archived {
                    library.folders.push(child.clone());
                }
                pending.push((entry.path(), child));
            } else if kind.is_file() {
                if let Some(name) = filename.strip_suffix(EXT) {
                    let modified = entry
                        .metadata()?
                        .modified()?
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_millis() as u64;
                    library.canvases.push(Entry {
                        name: name.to_owned(),
                        folder: folder.clone(),
                        modified,
                        archived,
                    });
                }
            }
        }
    }
    Ok(())
}

fn inventory(project: &Path) -> Result<Library> {
    let mut library = Library::default();
    let root = project.join("canvases");
    if !root.try_exists()? {
        return Ok(library);
    }
    let root = directory(project, "canvases", false)?;
    scan(&root, false, &mut library)?;
    if root.join(ARCHIVE).try_exists()? {
        scan(&directory(&root, ARCHIVE, false)?, true, &mut library)?;
    }
    library.folders.sort();
    Ok(library)
}

/// A conflicting file from a pull or another window must survive a move.
fn relocate(from: PathBuf, to: PathBuf, name: String) -> Result<String> {
    check_name(&name)?;
    let filename = format!("{name}{EXT}");
    let source = from.join(&filename);
    let dest = to.join(&filename);
    ensure!(
        source.symlink_metadata()?.is_file(),
        "Canvas is not a regular file"
    );
    if source != dest {
        #[cfg(any(target_os = "macos", target_os = "linux"))]
        {
            use rustix::fs::{renameat_with, RenameFlags, CWD};
            renameat_with(CWD, &source, CWD, &dest, RenameFlags::NOREPLACE)
                .with_context(|| format!("Could not move canvas to {}", dest.display()))?;
        }
        #[cfg(not(any(target_os = "macos", target_os = "linux")))]
        {
            fs::hard_link(&source, &dest)?;
            if let Err(error) = fs::remove_file(source) {
                fs::remove_file(dest)?;
                return Err(error.into());
            }
        }
    }
    Ok(name)
}

/// The directory inode survives a document replacement and is shared by servers editing this checkout.
#[cfg(unix)]
fn lock_library(root: &Path) -> Result<File> {
    let file = File::open(root)?;
    file.lock()?;
    Ok(file)
}

fn apply(project: &Path, action: Action) -> Result<String> {
    let root = directory(project, "canvases", true)?;
    #[cfg(unix)]
    let _checkout = lock_library(&root)?;
    match action {
        Action::Create { folder } => {
            let dir = folder_path(&root, &folder, false)?;
            for _ in 0..64 {
                let name = crate::store::random_three_word_name();
                let path = dir.join(format!("{name}{EXT}"));
                match File::create_new(&path) {
                    Ok(mut file) => {
                        if let Err(err) =
                            file.write_all(b"{\n  \"version\": 1,\n  \"elements\": []\n}\n")
                        {
                            fs::remove_file(path)?;
                            return Err(err.into());
                        }
                        return Ok(name);
                    }
                    Err(e) if e.kind() == ErrorKind::AlreadyExists => continue,
                    Err(e) => return Err(e.into()),
                }
            }
            bail!("Could not find an unused canvas name")
        }
        Action::Folder { folder, name } => {
            check_name(&name)?;
            let dir = folder_path(&root, &folder, false)?.join(&name);
            fs::create_dir(&dir)?;
            // Git cannot share an empty directory on its own.
            if let Err(e) = File::create_new(dir.join(".gitkeep")) {
                fs::remove_dir(dir)?;
                return Err(e.into());
            }
            Ok(name)
        }
        Action::Move {
            folder,
            name,
            destination,
        } => relocate(
            folder_path(&root, &folder, false)?,
            folder_path(&root, &destination, false)?,
            name,
        ),
        Action::Archive { folder, name } => relocate(
            folder_path(&root, &folder, false)?,
            folder_path(&directory(&root, ARCHIVE, true)?, &folder, true)?,
            name,
        ),
        Action::Restore { folder, name } => relocate(
            folder_path(&directory(&root, ARCHIVE, false)?, &folder, false)?,
            folder_path(&root, &folder, true)?,
            name,
        ),
    }
}

pub(crate) async fn attached(path: String) -> Result<PathBuf> {
    ensure!(
        crate::projects::list_projects()
            .await?
            .iter()
            .any(|p| p.path == path),
        "Attach this project to open its canvases"
    );
    let path = PathBuf::from(path);
    ensure!(
        path.symlink_metadata()?.is_dir(),
        "Project directory is unavailable"
    );
    Ok(path)
}

/// Read directly from the checkout so a pull or branch switch changes the library.
pub(crate) async fn list(project_path: String) -> Result<Library, crate::Fail> {
    let project = attached(project_path).await?;
    Ok(tokio::task::spawn_blocking(move || inventory(&project))
        .await
        .context("Canvas scan stopped")??)
}

/// Serialize library moves so concurrent windows cannot take the same file twice.
pub(crate) async fn change(project_path: String, action: Action) -> Result<String, crate::Fail> {
    let project = attached(project_path).await?;
    Ok(tokio::task::spawn_blocking(move || {
        let _guard = WRITES.blocking_lock();
        apply(&project, action)
    })
    .await
    .context("Canvas update stopped")??)
}

fn document_path(project: &Path, folder: &str, name: &str, archived: bool) -> Result<PathBuf> {
    check_name(name)?;
    let root = directory(project, "canvases", false)?;
    let root = if archived {
        directory(&root, ARCHIVE, false)?
    } else {
        root
    };
    let path = folder_path(&root, folder, false)?.join(format!("{name}{EXT}"));
    ensure!(path.symlink_metadata()?.is_file(), "Canvas is unavailable");
    Ok(path)
}

/// Read a canvas from the attached project, including files created by the library alone.
pub(crate) async fn read(
    project_path: String,
    folder: String,
    name: String,
    archived: bool,
) -> Result<String, crate::Fail> {
    let project = attached(project_path).await?;
    Ok(
        tokio::fs::read_to_string(document_path(&project, &folder, &name, archived)?)
            .await
            .context("Could not read canvas")?,
    )
}

/// Compare the last read under the same lock as archive and move.
fn save_document(
    project: &Path,
    folder: &str,
    name: &str,
    previous: &str,
    content: &str,
    archived: bool,
) -> Result<()> {
    #[cfg(unix)]
    let _checkout = lock_library(&directory(project, "canvases", false)?)?;
    let path = document_path(project, folder, name, archived)?;
    ensure!(
        fs::read_to_string(&path)? == previous,
        "Canvas changed on disk. Reload the latest version before saving."
    );
    let data: serde_json::Value = serde_json::from_str(content)?;
    ensure!(
        data["version"] == 1 && data["elements"].is_array(),
        "Invalid canvas document"
    );
    let tmp = path.with_file_name(format!(".{}.tmp", uuid::Uuid::new_v4()));
    let mut file = File::create_new(&tmp)?;
    let result = (|| {
        file.set_permissions(path.metadata()?.permissions())?;
        file.write_all(content.as_bytes())?;
        drop(file);
        fs::rename(&tmp, &path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    Ok(result?)
}

/// Replace a canvas only while its source revision is still current.
pub(crate) async fn save(
    project_path: String,
    folder: String,
    name: String,
    previous: String,
    content: String,
    archived: bool,
) -> Result<(), crate::Fail> {
    let project = attached(project_path).await?;
    Ok(tokio::task::spawn_blocking(move || {
        let _guard = WRITES.blocking_lock();
        save_document(&project, &folder, &name, &previous, &content, archived)
    })
    .await
    .context("Canvas save stopped")??)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stale_edits_cannot_overwrite_or_recreate_a_moved_canvas() -> Result<()> {
        let project = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        fs::create_dir(&project)?;
        let name = apply(
            &project,
            Action::Create {
                folder: String::new(),
            },
        )?;
        let path = document_path(&project, "", &name, false)?;
        let original = fs::read_to_string(&path)?;
        let edited = r##"{"version":1,"elements":[],"pages":[{"background":"#abcdef"}]}"##;
        save_document(&project, "", &name, &original, edited, false)?;
        assert!(save_document(&project, "", &name, &original, &original, false).is_err());
        assert_eq!(fs::read_to_string(&path)?, edited);
        apply(
            &project,
            Action::Archive {
                folder: String::new(),
                name: name.clone(),
            },
        )?;
        assert!(save_document(&project, "", &name, edited, &original, false).is_err());
        save_document(&project, "", &name, edited, &original, true)?;
        assert!(!path.exists());
        fs::remove_dir_all(&project)?;
        Ok(())
    }

    #[test]
    fn created_files_survive_move_archive_restore_and_a_fresh_scan() -> Result<()> {
        let project = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        fs::create_dir(&project)?;
        assert!(inventory(&project)?.canvases.is_empty());
        let name = apply(&project, Action::Create { folder: "".into() })?;
        let bytes = fs::read(project.join("canvases").join(format!("{name}{EXT}")))?;
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&bytes)?["elements"],
            serde_json::json!([])
        );
        let another = apply(&project, Action::Create { folder: "".into() })?;
        assert_ne!(name, another);
        apply(
            &project,
            Action::Folder {
                folder: "".into(),
                name: "Website".into(),
            },
        )?;
        assert!(project.join("canvases/Website/.gitkeep").is_file());
        apply(
            &project,
            Action::Move {
                folder: "".into(),
                name: name.clone(),
                destination: "Website".into(),
            },
        )?;
        apply(
            &project,
            Action::Archive {
                folder: "Website".into(),
                name: name.clone(),
            },
        )?;
        assert!(inventory(&project)?
            .canvases
            .iter()
            .any(|c| c.name == name && c.archived));
        let restore = || Action::Restore {
            folder: "Website".into(),
            name: name.clone(),
        };
        let original = project
            .join("canvases/Website")
            .join(format!("{name}{EXT}"));
        fs::write(&original, "existing")?;
        assert!(apply(&project, restore()).is_err());
        assert_eq!(fs::read_to_string(&original)?, "existing");
        fs::remove_file(&original)?;
        apply(&project, restore())?;
        assert_eq!(fs::read(original)?, bytes);
        assert!(apply(
            &project,
            Action::Create {
                folder: "../".into()
            }
        )
        .is_err());
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(&project, project.join("canvases/alias"))?;
            assert!(apply(
                &project,
                Action::Create {
                    folder: "alias".into()
                }
            )
            .is_err());
        }
        fs::remove_dir_all(project)?;
        Ok(())
    }
}
