use carbon_proto::{RecoveryRequest, Request, Response};
use clap::Subcommand;

#[derive(Subcommand)]
pub enum RecoveryCommand {
    /// Hide an inspected outcome without changing its retry fence or task result.
    Dismiss { session_id: String, id: String },
    /// List durable interruption reasons and available actions as JSON.
    List { session_id: Option<String> },
    /// Send a continuation immediately, once per interruption ID.
    Resume { session_id: String, id: String },
    /// Retry a delivery confirmed to have failed before submission.
    Retry { session_id: String, id: String },
}

/// Headless callers use the same recovery fences as the app's buttons.
pub fn run(command: RecoveryCommand) -> Result<(), String> {
    let request = match command {
        RecoveryCommand::Dismiss { session_id, id } => RecoveryRequest::Dismiss { session_id, id },
        RecoveryCommand::List { session_id } => RecoveryRequest::List { session_id },
        RecoveryCommand::Resume { session_id, id } => RecoveryRequest::Resume { session_id, id },
        RecoveryCommand::Retry { session_id, id } => RecoveryRequest::Retry { session_id, id },
    };
    match super::send(Request::Recovery(request))? {
        Response::Recovery { value } => {
            println!(
                "{}",
                serde_json::to_string_pretty(&value).map_err(|error| error.to_string())?
            );
            Ok(())
        }
        Response::Error { message } => Err(message),
        other => Err(super::unexpected(other)),
    }
}
