use carbon_proto::{PreviewRequest, Request, Response};
use clap::{Args, Subcommand};

#[derive(Subcommand)]
pub enum PreviewCommand {
    /// Reuse a live preview or start it, then print its URL once ready.
    Start(Start),
    /// Stop the managed preview and its child processes.
    Stop(Session),
    /// Print the running preview's URL without starting anything.
    Url(Session),
    /// Print the latest run's bounded log as untrusted context.
    Logs(Session),
}

#[derive(Args)]
pub struct Session {
    /// Defaults to the calling Carbon session.
    #[arg(long)]
    session: Option<String>,
}

#[derive(Args)]
pub struct Start {
    #[command(flatten)]
    session: Session,
    /// Override and save the project's dev command. Use {port} or PORT.
    #[arg(long)]
    command: Option<String>,
    /// Override and save the app folder, relative to the session checkout.
    #[arg(long)]
    directory: Option<String>,
}

fn session(args: Session) -> Result<String, String> {
    args.session
        .or_else(super::parent_session_id)
        .ok_or("Run inside a Carbon session, or pass --session <id>.".into())
}

/// The URL stays on stdout so it can be passed directly to `carbon browser open`.
pub fn run(command: PreviewCommand) -> Result<(), String> {
    let request = match command {
        PreviewCommand::Start(args) => PreviewRequest::Start {
            session_id: session(args.session)?,
            command: args.command,
            directory: args.directory,
        },
        PreviewCommand::Stop(args) => PreviewRequest::Stop {
            session_id: session(args)?,
        },
        PreviewCommand::Url(args) => PreviewRequest::Url {
            session_id: session(args)?,
        },
        PreviewCommand::Logs(args) => PreviewRequest::Logs {
            session_id: session(args)?,
        },
    };
    match super::send(Request::Preview(request))? {
        Response::Preview { url, logs } => {
            if let Some(logs) = logs {
                super::untrusted_output("preview logs");
                print!("{logs}");
            } else if let Some(url) = url {
                println!("{url}");
            } else {
                println!("Preview stopped.");
            }
            Ok(())
        }
        Response::PreviewFailed { message, logs } => {
            eprintln!("carbon: {message}");
            super::untrusted_output("preview logs");
            eprintln!("{logs}");
            Err("Preview did not become ready. Check the log above.".into())
        }
        Response::Error { message } => Err(message),
        other => Err(super::unexpected(other)),
    }
}
