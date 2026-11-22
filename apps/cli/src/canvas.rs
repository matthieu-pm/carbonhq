use carbon_proto::{
    canvas::{CanvasCommand, CanvasRequest},
    Request, Response,
};

#[derive(clap::Args)]
pub struct CanvasArgs {
    /// Attached project path on the target machine. Defaults to the current Git project or directory.
    #[arg(long, global = true)]
    project: Option<String>,
    /// Folder within the project's canvas library.
    #[arg(long, global = true, default_value = "")]
    folder: String,
    /// Canvas name returned by create or list.
    #[arg(long, global = true)]
    canvas: Option<String>,
    /// Apply a document edit only at this revision.
    #[arg(long, global = true)]
    revision: Option<String>,
    #[command(subcommand)]
    command: CanvasCommand,
}

/// All commands print JSON so an agent can pass returned IDs to the next action.
pub fn run(args: CanvasArgs) -> Result<(), String> {
    let project = match args.project {
        Some(path) => path,
        None => {
            let cwd = std::env::current_dir().map_err(|e| e.to_string())?;
            super::repo_root(&cwd).unwrap_or_else(|| cwd.display().to_string())
        }
    };
    let request = CanvasRequest {
        project,
        folder: args.folder,
        canvas: args.canvas,
        revision: args.revision,
        command: args.command,
    };
    match super::send(Request::Canvas(request))? {
        Response::Canvas { data } => {
            println!(
                "{}",
                serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?
            );
            Ok(())
        }
        Response::Error { message } => Err(message),
        other => Err(super::unexpected(other)),
    }
}
