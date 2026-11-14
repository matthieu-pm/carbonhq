use carbon_proto::{Request, Response, SecretField, SecretRequest, SecretSelector, SecretTarget};
use clap::{Args, Subcommand};

#[derive(Subcommand)]
pub enum SecretCommand {
    /// Run an approved command with secrets in its environment.
    Command(CommandArgs),
    /// Supply an env file for a command; use {secret_file} in its arguments.
    File(FileArgs),
    /// Fill and submit a login form on an approved HTTPS origin.
    Browser(BrowserArgs),
    /// Read the status and redacted output of a hand-off.
    Status(ReferenceArgs),
    /// Withdraw a hand-off that has not started.
    Cancel(ReferenceArgs),
}

#[derive(Args)]
pub struct Ask {
    #[arg(long)]
    session: Option<String>,
    #[arg(long)]
    purpose: String,
    /// A variable name, optionally followed by =Human-readable label. Never a secret value.
    #[arg(long = "field", required = true)]
    fields: Vec<String>,
}

#[derive(Args)]
pub struct CommandArgs {
    #[command(flatten)]
    ask: Ask,
    #[arg(last = true, required = true)]
    command: Vec<String>,
}

#[derive(Args)]
pub struct FileArgs {
    #[command(flatten)]
    ask: Ask,
    /// Where the user may explicitly choose to keep the env file, inside the session checkout.
    #[arg(long)]
    path: String,
    #[arg(last = true)]
    command: Vec<String>,
}

#[derive(Args)]
pub struct BrowserArgs {
    #[command(flatten)]
    ask: Ask,
    #[arg(long)]
    origin: String,
    /// NAME=CSS_SELECTOR for each field. Never a secret value.
    #[arg(long = "selector", required = true)]
    selectors: Vec<String>,
    /// CSS selector for the form's submit button.
    #[arg(long)]
    submit: String,
}

#[derive(Args)]
pub struct ReferenceArgs {
    id: String,
    #[arg(long)]
    session: Option<String>,
}

fn session(given: Option<String>) -> Result<String, String> {
    given
        .or_else(super::parent_session_id)
        .ok_or("Run inside a Carbon session, or pass --session.".into())
}

fn create(ask: Ask, target: SecretTarget) -> Result<SecretRequest, String> {
    Ok(SecretRequest::Create {
        session_id: session(ask.session)?,
        purpose: ask.purpose,
        fields: ask
            .fields
            .into_iter()
            .map(|field| {
                let (name, label) = field.split_once('=').unwrap_or((&field, &field));
                SecretField {
                    name: name.into(),
                    label: label.into(),
                }
            })
            .collect(),
        target,
    })
}

/// Secret values are intentionally absent from this CLI and its stdin.
pub fn run(command: SecretCommand) -> Result<(), String> {
    let request = match command {
        SecretCommand::Command(args) => create(
            args.ask,
            SecretTarget::Command {
                command: args.command,
            },
        )?,
        SecretCommand::File(args) => create(
            args.ask,
            SecretTarget::File {
                path: args.path,
                command: args.command,
            },
        )?,
        SecretCommand::Browser(args) => {
            let fields = args
                .selectors
                .into_iter()
                .map(|field| {
                    let (name, selector) = field
                        .split_once('=')
                        .ok_or("Use --selector NAME=CSS_SELECTOR.")?;
                    Ok(SecretSelector {
                        name: name.into(),
                        selector: selector.into(),
                    })
                })
                .collect::<Result<Vec<_>, String>>()?;
            create(
                args.ask,
                SecretTarget::Browser {
                    origin: args.origin,
                    fields,
                    submit: args.submit,
                },
            )?
        }
        SecretCommand::Status(args) => SecretRequest::Status {
            session_id: session(args.session)?,
            id: args.id,
        },
        SecretCommand::Cancel(args) => SecretRequest::Cancel {
            session_id: session(args.session)?,
            id: args.id,
        },
    };
    match super::send(Request::Secret(request))? {
        Response::Secret { data } => {
            println!(
                "{}",
                serde_json::to_string_pretty(&data)
                    .map_err(|_| "Could not format hand-off status.")?
            );
            Ok(())
        }
        Response::Error { message } => Err(message),
        other => Err(super::unexpected(other)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use clap::Parser;

    #[test]
    fn command_arguments_stay_separate_and_values_have_no_cli_flag() {
        let cli = crate::Cli::try_parse_from([
            "carbon",
            "secret",
            "command",
            "--purpose",
            "Deploy",
            "--field",
            "TOKEN=Deploy token",
            "--",
            "tool",
            "an argument",
        ])
        .unwrap();
        let crate::Command::Secret(SecretCommand::Command(args)) = cli.command else {
            panic!()
        };
        assert_eq!(args.command, ["tool", "an argument"]);
        assert_eq!(args.ask.fields, ["TOKEN=Deploy token"]);
        assert!(crate::Cli::try_parse_from([
            "carbon",
            "secret",
            "command",
            "--purpose",
            "Deploy",
            "--field",
            "TOKEN",
            "--value",
            "forbidden",
            "--",
            "tool"
        ])
        .is_err());
    }

    #[test]
    fn browser_bindings_and_file_only_handoffs_parse() {
        assert!(crate::Cli::try_parse_from([
            "carbon",
            "secret",
            "browser",
            "--purpose",
            "Sign in",
            "--field",
            "PASSWORD",
            "--origin",
            "https://example.com",
            "--selector",
            "PASSWORD=#password",
            "--submit",
            "button[type=submit]"
        ])
        .is_ok());
        assert!(crate::Cli::try_parse_from([
            "carbon",
            "secret",
            "file",
            "--purpose",
            "Configure",
            "--field",
            "TOKEN",
            "--path",
            ".env.local"
        ])
        .is_ok());
    }
}
