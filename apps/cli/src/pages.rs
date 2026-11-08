use std::{io::Read, path::PathBuf};

use base64::{engine::general_purpose::STANDARD, Engine};
use carbon_proto::{PageRequest, Request, Response};
use clap::{Args, Subcommand};

#[derive(Subcommand)]
pub enum PagesCommand {
    /// List Pages, optionally narrowed to a project or Trash.
    #[command(alias = "ls")]
    List(List),
    /// Search Page titles and Markdown bodies.
    Search(Search),
    /// Read a Page and its revision; --markdown prints only its body.
    Read(ReadPage),
    /// List the latest 100 committed revisions of a Page.
    History(PageId),
    /// Read an immutable revision without changing the current Page.
    ReadVersion(ReadVersion),
    /// Restore an earlier version as a new revision, retaining current Trash state.
    RestoreVersion(RestoreVersion),
    /// Attach a file up to 20 MiB using chunks below the agent wire limit.
    Attach(Attach),
    /// List the Page's completed attachments and their stable Markdown URLs.
    Assets(PageId),
    /// List Pages whose Markdown links to this Page.
    Backlinks(Backlinks),
    /// Discover Linear documents without importing or linking them.
    LinearList(LinearList),
    /// Read one Linear document without linking it.
    LinearRead(DocumentId),
    /// Import and explicitly link a Linear document to a Carbon Page.
    ImportLinear(ImportLinear),
    /// Read durable local sync state without contacting Linear.
    SyncStatus(PageId),
    /// Sync a linked Page; explicit conflict decisions guard both shown versions.
    Sync(Sync),
    /// Remove the sync link, retaining both documents and local history.
    UnlinkLinear(Revision),
    /// Create one Markdown document, optionally linked to several projects.
    Create(Create),
    /// Update a Page against the revision returned by read.
    Update(Update),
    /// Replace one unique, exact text selection against a known revision.
    Patch(Patch),
    /// Move a Page into Trash, retaining its content and history.
    Trash(Revision),
    /// Restore a Page from Trash.
    Restore(Revision),
}

#[derive(Args)]
pub struct List {
    #[arg(long)]
    project: Option<String>,
    #[arg(long)]
    trashed: bool,
}

#[derive(Args)]
pub struct Search {
    query: String,
    #[arg(long)]
    project: Option<String>,
    #[arg(long)]
    trashed: bool,
}

#[derive(Args)]
pub struct ReadPage {
    id: String,
    #[arg(long)]
    markdown: bool,
    /// Read this historical revision rather than the current Page.
    #[arg(long)]
    version: Option<u64>,
}

#[derive(Args)]
pub struct PageId {
    id: String,
}

#[derive(Args)]
pub struct Attach {
    id: String,
    #[arg(long)]
    file: PathBuf,
}

#[derive(Args)]
pub struct Backlinks {
    id: String,
    /// The target Page's server connection ID; defaults to local.
    #[arg(long)]
    owner: Option<String>,
    /// This scanned store's server connection ID; defaults to local.
    #[arg(long)]
    source_owner: Option<String>,
}

#[derive(Args)]
pub struct LinearList {
    #[arg(long)]
    query: Option<String>,
    #[arg(long)]
    after: Option<String>,
}

#[derive(Args)]
pub struct DocumentId {
    document_id: String,
}

#[derive(Args)]
pub struct ImportLinear {
    document_id: String,
    #[arg(long = "project")]
    projects: Vec<String>,
}

#[derive(Args)]
pub struct Sync {
    id: String,
    #[arg(long)]
    revision: u64,
    #[arg(long, value_parser = ["carbon", "linear"], requires = "expected_remote_updated_at")]
    resolution: Option<String>,
    #[arg(long, requires = "resolution")]
    expected_remote_updated_at: Option<String>,
}

#[derive(Args)]
pub struct ReadVersion {
    id: String,
    version: u64,
    #[arg(long)]
    markdown: bool,
}

#[derive(Args)]
pub struct RestoreVersion {
    id: String,
    version: u64,
    #[arg(long)]
    revision: u64,
}

#[derive(Args)]
pub struct Create {
    #[arg(long)]
    title: String,
    /// UTF-8 Markdown file, or - for stdin. Omit for an empty Page.
    #[arg(long)]
    file: Option<PathBuf>,
    /// Absolute project path on the owning server. Repeat for several projects.
    #[arg(long = "project")]
    projects: Vec<String>,
}

#[derive(Args)]
pub struct Update {
    id: String,
    #[arg(long)]
    revision: u64,
    #[arg(long)]
    title: Option<String>,
    /// UTF-8 Markdown file, or - for stdin. Omit to keep the body.
    #[arg(long)]
    file: Option<PathBuf>,
    /// Replace all project links. Repeat for several; --clear-projects removes all.
    #[arg(long = "project", conflicts_with = "clear_projects")]
    projects: Vec<String>,
    #[arg(long)]
    clear_projects: bool,
    #[arg(long)]
    favorite: Option<bool>,
}

#[derive(Args)]
pub struct Patch {
    id: String,
    #[arg(long)]
    revision: u64,
    #[arg(long)]
    old_text: String,
    #[arg(long)]
    new_text: String,
}

#[derive(Args)]
pub struct Revision {
    id: String,
    #[arg(long)]
    revision: u64,
}

/// Every operation prints JSON with the new revision, so an agent can make its next guarded edit.
pub fn run(command: PagesCommand) -> Result<(), String> {
    let mut markdown_only = false;
    let request = match command {
        PagesCommand::Attach(args) => return attach(args),
        PagesCommand::LinearList(args) => PageRequest::LinearList {
            query: args.query,
            after: args.after,
        },
        PagesCommand::LinearRead(args) => PageRequest::LinearRead {
            document_id: args.document_id,
        },
        PagesCommand::ImportLinear(args) => PageRequest::ImportLinear {
            document_id: args.document_id,
            project_paths: args.projects,
        },
        PagesCommand::SyncStatus(args) => PageRequest::SyncStatus { id: args.id },
        PagesCommand::Sync(args) => PageRequest::SyncLinear {
            id: args.id,
            revision: args.revision,
            resolution: args.resolution,
            expected_remote_updated_at: args.expected_remote_updated_at,
        },
        PagesCommand::UnlinkLinear(args) => PageRequest::UnlinkLinear {
            id: args.id,
            revision: args.revision,
        },
        PagesCommand::Assets(args) => PageRequest::Assets { id: args.id },
        PagesCommand::Backlinks(args) => PageRequest::Backlinks {
            id: args.id,
            owner: args.owner,
            source_owner: args.source_owner,
        },
        PagesCommand::List(args) => PageRequest::List {
            query: None,
            project_path: args.project,
            trashed: args.trashed,
        },
        PagesCommand::Search(args) => PageRequest::List {
            query: Some(args.query),
            project_path: args.project,
            trashed: args.trashed,
        },
        PagesCommand::Read(args) => {
            markdown_only = args.markdown;
            match args.version {
                Some(version) => PageRequest::ReadVersion {
                    id: args.id,
                    version,
                },
                None => PageRequest::Read { id: args.id },
            }
        }
        PagesCommand::History(args) => PageRequest::History { id: args.id },
        PagesCommand::ReadVersion(args) => {
            markdown_only = args.markdown;
            PageRequest::ReadVersion {
                id: args.id,
                version: args.version,
            }
        }
        PagesCommand::RestoreVersion(args) => PageRequest::RestoreVersion {
            id: args.id,
            revision: args.revision,
            version: args.version,
        },
        PagesCommand::Create(args) => PageRequest::Create {
            title: args.title,
            markdown: args
                .file
                .map(read_markdown)
                .transpose()?
                .unwrap_or_default(),
            project_paths: args.projects,
        },
        PagesCommand::Update(args) => PageRequest::Update {
            id: args.id,
            revision: args.revision,
            title: args.title,
            markdown: args.file.map(read_markdown).transpose()?,
            project_paths: (args.clear_projects || !args.projects.is_empty())
                .then_some(args.projects),
            favorite: args.favorite,
        },
        PagesCommand::Patch(args) => PageRequest::Patch {
            id: args.id,
            revision: args.revision,
            old_text: args.old_text,
            new_text: args.new_text,
        },
        PagesCommand::Trash(args) => PageRequest::Trash {
            id: args.id,
            revision: args.revision,
            trashed: true,
        },
        PagesCommand::Restore(args) => PageRequest::Trash {
            id: args.id,
            revision: args.revision,
            trashed: false,
        },
    };
    match super::send(Request::Pages(request))? {
        Response::Pages { data } => {
            if markdown_only {
                print!(
                    "{}",
                    data["markdown"]
                        .as_str()
                        .ok_or("Page response has no Markdown.")?
                );
            } else {
                println!(
                    "{}",
                    serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?
                );
            }
            Ok(())
        }
        Response::Error { message } => Err(message),
        other => Err(super::unexpected(other)),
    }
}

fn read_markdown(path: PathBuf) -> Result<String, String> {
    let reader: Box<dyn Read> = if path.as_os_str() == "-" {
        Box::new(std::io::stdin())
    } else {
        Box::new(
            std::fs::File::open(&path)
                .map_err(|e| format!("Could not read {}: {e}", path.display()))?,
        )
    };
    let mut text = String::new();
    reader
        .take(256 * 1024 + 1)
        .read_to_string(&mut text)
        .map_err(|e| e.to_string())?;
    if text.len() > 256 * 1024 {
        return Err("Page Markdown must be 256 KiB or smaller.".into());
    }
    Ok(text)
}

/// One stable upload ID lets retries confirm a final chunk without replacing another attachment.
fn attach(args: Attach) -> Result<(), String> {
    let mut file = std::fs::File::open(&args.file).map_err(|e| e.to_string())?;
    let meta = file.metadata().map_err(|e| e.to_string())?;
    if !meta.is_file() || meta.len() > 20 * 1024 * 1024 {
        return Err("Attach a file of 20 MiB or smaller.".into());
    }
    let name = args
        .file
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or("Attachment file name is not UTF-8.")?
        .to_string();
    let asset_id = uuid::Uuid::new_v4().to_string();
    let mut offset = 0;
    loop {
        let count = (meta.len() - offset).min(256 * 1024) as usize;
        let mut bytes = vec![0; count];
        file.read_exact(&mut bytes)
            .map_err(|e| format!("Attachment changed while reading it: {e}"))?;
        let end = offset + count as u64;
        let complete = end == meta.len();
        match super::send(Request::Pages(PageRequest::WriteAsset {
            id: args.id.clone(),
            name: name.clone(),
            asset_id: asset_id.clone(),
            offset,
            data: STANDARD.encode(&bytes),
            complete,
        }))? {
            Response::Pages { data } => {
                if data["written"].as_u64() != Some(end) {
                    return Err("Asset server answered an unexpected upload offset.".into());
                }
                if complete {
                    if !data["asset"].is_object() {
                        return Err("Asset upload was not finalized.".into());
                    }
                    println!(
                        "{}",
                        serde_json::to_string_pretty(&data["asset"]).map_err(|e| e.to_string())?
                    );
                    return Ok(());
                }
            }
            Response::Error { message } => return Err(message),
            other => return Err(super::unexpected(other)),
        }
        offset = end;
    }
}

#[cfg(test)]
mod tests {
    use clap::Parser;

    #[test]
    fn writes_require_a_revision_and_project_clearing_is_explicit() {
        assert!(crate::Cli::try_parse_from(["carbon", "pages", "attach", "id"]).is_err());
        assert!(crate::Cli::try_parse_from([
            "carbon",
            "pages",
            "sync",
            "id",
            "--revision",
            "1",
            "--resolution",
            "carbon"
        ])
        .is_err());
        assert!(crate::Cli::try_parse_from([
            "carbon",
            "pages",
            "sync",
            "id",
            "--revision",
            "1",
            "--resolution",
            "linear",
            "--expected-remote-updated-at",
            "2026-11-08T00:00:00Z"
        ])
        .is_ok());
        assert!(
            crate::Cli::try_parse_from(["carbon", "pages", "update", "id", "--title", "Next"])
                .is_err()
        );
        assert!(crate::Cli::try_parse_from(["carbon", "pages", "trash", "id"]).is_err());
        assert!(
            crate::Cli::try_parse_from(["carbon", "pages", "restore-version", "id", "1"]).is_err()
        );
        assert!(crate::Cli::try_parse_from([
            "carbon",
            "pages",
            "read-version",
            "id",
            "1",
            "--markdown"
        ])
        .is_ok());
        assert!(crate::Cli::try_parse_from([
            "carbon",
            "pages",
            "update",
            "id",
            "--revision",
            "1",
            "--clear-projects",
            "--project",
            "/repo"
        ])
        .is_err());
        assert!(crate::Cli::try_parse_from([
            "carbon",
            "--machine",
            "vps",
            "pages",
            "patch",
            "id",
            "--revision",
            "2",
            "--old-text",
            "old",
            "--new-text",
            "new"
        ])
        .is_ok());
    }
}
