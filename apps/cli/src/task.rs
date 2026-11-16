use carbon_proto::{Request, Response, TaskRequest};
use clap::Subcommand;

#[derive(Subcommand)]
pub enum TaskCommand {
    /// Read current state, blocking questions and completion delivery as JSON.
    Status { task_id: String },
    /// Read the immutable published result as JSON.
    Result { task_id: String },
    /// Wait for a result or blocking question. Timing out leaves the task running.
    Wait {
        task_id: String,
        #[arg(long, default_value_t = 30, value_parser = clap::value_parser!(u64).range(0..=120))]
        timeout: u64,
    },
    /// Cancel this task and awaited descendants, removing their queued follow-ups.
    Cancel { task_id: String },
}

/// Task IDs address durable records independently of session browsing status.
pub fn run(command: TaskCommand) -> Result<(), String> {
    let result_only = matches!(command, TaskCommand::Result { .. });
    let request = match command {
        TaskCommand::Status { task_id } => TaskRequest::Status { task_id },
        TaskCommand::Result { task_id } => TaskRequest::Result { task_id },
        TaskCommand::Wait { task_id, timeout } => TaskRequest::Wait {
            task_id,
            timeout_secs: timeout,
        },
        TaskCommand::Cancel { task_id } => TaskRequest::Cancel { task_id },
    };
    match super::send(Request::Task(request))? {
        Response::Task { task } => {
            let data = if result_only {
                serde_json::to_value(task.result.ok_or("The task has no published result yet.")?)
            } else {
                serde_json::to_value(task)
            }
            .map_err(|error| error.to_string())?;
            println!(
                "{}",
                serde_json::to_string_pretty(&data).map_err(|error| error.to_string())?
            );
            Ok(())
        }
        Response::Error { message } => Err(message),
        other => Err(super::unexpected(other)),
    }
}
