use std::path::{Path, PathBuf};

use serde::Deserialize;
use tauri_plugin_dialog::DialogExt;

#[derive(Debug, Deserialize)]
pub struct MarkdownFile {
    pub title: String,
    pub markdown: String,
}

/// Saves Pages as `.md` files where the reader picks: a save sheet for one, a
/// folder for several. The dialog runs here rather than in the webview so the
/// webview never names a path, which would make this a write-anywhere command.
/// `None` when the reader cancels.
#[tauri::command]
pub async fn save_markdown_files(
    app: tauri::AppHandle,
    files: Vec<MarkdownFile>,
) -> Result<Option<String>, String> {
    if files.is_empty() {
        return Ok(None);
    }
    tokio::task::spawn_blocking(move || {
        let dialog = app.dialog().file();
        if let [file] = files.as_slice() {
            let Some(picked) = dialog
                .set_file_name(format!("{}.md", file_name(&file.title)))
                .add_filter("Markdown", &["md"])
                .blocking_save_file()
            else {
                return Ok(None);
            };
            let path = picked.into_path().map_err(|e| e.to_string())?;
            std::fs::write(&path, &file.markdown).map_err(|e| e.to_string())?;
            return Ok(Some(path.display().to_string()));
        }
        let Some(picked) = dialog.blocking_pick_folder() else {
            return Ok(None);
        };
        let dir = picked.into_path().map_err(|e| e.to_string())?;
        for file in &files {
            let path = free_path(&dir, &file_name(&file.title));
            std::fs::write(&path, &file.markdown).map_err(|e| e.to_string())?;
        }
        Ok(Some(dir.display().to_string()))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// A title as a file name: path separators and control characters out, and
/// never empty or hidden.
fn file_name(title: &str) -> String {
    let cleaned: String = title
        .chars()
        .map(|c| if matches!(c, '/' | '\\' | ':') || c.is_control() { '-' } else { c })
        .collect();
    let trimmed = cleaned.trim().trim_start_matches('.').trim();
    if trimmed.is_empty() { "Untitled".into() } else { trimmed.chars().take(120).collect() }
}

/// `<stem>.md`, numbered past anything already in the folder — two Pages can
/// share a title, and a folder pick must not overwrite what the reader had.
fn free_path(dir: &Path, stem: &str) -> PathBuf {
    let first = dir.join(format!("{stem}.md"));
    if !first.exists() {
        return first;
    }
    (2..)
        .map(|n| dir.join(format!("{stem} {n}.md")))
        .find(|path| !path.exists())
        .expect("an unbounded range finds a free name")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn titles_become_safe_file_names() {
        assert_eq!(file_name("Plan: v2/draft"), "Plan- v2-draft");
        assert_eq!(file_name("  ..hidden "), "hidden");
        assert_eq!(file_name(""), "Untitled");
    }

    #[test]
    fn a_taken_name_is_numbered_rather_than_overwritten() {
        let dir = std::env::temp_dir().join(format!("carbon-export-{}", uuid::Uuid::now_v7()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("Notes.md"), "").unwrap();
        assert_eq!(free_path(&dir, "Notes"), dir.join("Notes 2.md"));
        assert_eq!(free_path(&dir, "Other"), dir.join("Other.md"));
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
