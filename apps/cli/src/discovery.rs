use carbon_proto::{DiscoveryData, DiscoveryRequest, Request, Response};
use clap::{Args, Subcommand};

#[derive(Subcommand)]
pub enum HarnessCommand {
    /// List native and enabled ACP harnesses on this machine.
    Ls(Output),
    /// Show capabilities, modes, options and controls locked during a turn.
    Inspect {
        harness: String,
        #[arg(long)]
        json: bool,
    },
}

#[derive(Args)]
pub struct Output {
    /// Print structured JSON.
    #[arg(long)]
    json: bool,
}

#[derive(Subcommand)]
pub enum ModelCommand {
    /// Search a harness's models, effort levels and fast-mode support.
    Ls {
        #[arg(long)]
        harness: String,
        /// Match a model's ID, alias, label or provider, ignoring case.
        #[arg(long)]
        query: Option<String>,
        #[arg(long, default_value_t = 50, value_parser = clap::value_parser!(u32).range(1..=100))]
        limit: u32,
        /// Continue the same query using the previous page's nextCursor.
        #[arg(long)]
        cursor: Option<String>,
        #[arg(long)]
        json: bool,
    },
}

pub fn harness(command: HarnessCommand) -> Result<(), String> {
    let (request, json) = match command {
        HarnessCommand::Ls(output) => (DiscoveryRequest::Harnesses, output.json),
        HarnessCommand::Inspect { harness, json } => (DiscoveryRequest::Harness { harness }, json),
    };
    run(request, json)
}

pub fn model(command: ModelCommand) -> Result<(), String> {
    let ModelCommand::Ls {
        harness,
        query,
        limit,
        cursor,
        json,
    } = command;
    run(
        DiscoveryRequest::Models {
            harness,
            query,
            limit,
            cursor,
        },
        json,
    )
}

fn run(request: DiscoveryRequest, json: bool) -> Result<(), String> {
    let data = match super::send(Request::Discover(request))? {
        Response::Discovery { data } => data,
        Response::Error { message } => return Err(message),
        other => return Err(super::unexpected(other)),
    };
    if json {
        println!(
            "{}",
            serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?
        );
        return Ok(());
    }
    match data {
        DiscoveryData::Harnesses { harnesses } => {
            println!("HARNESS\tAVAILABLE\tLABEL\tREASON");
            for h in harnesses {
                println!(
                    "{}\t{}\t{}\t{}",
                    h.harness,
                    h.available,
                    h.label,
                    h.reason.unwrap_or_default()
                );
            }
        }
        DiscoveryData::Harness {
            harness,
            capabilities,
            live_controls,
            modes,
            options,
            options_source,
            default_model,
        } => {
            println!(
                "{} ({})\nAvailable: {}",
                harness.label, harness.harness, harness.available
            );
            if let Some(reason) = harness.reason {
                println!("Reason: {reason}");
            }
            println!(
                "Default model: {}",
                default_model.as_deref().unwrap_or("chosen by the harness")
            );
            println!("\nCAPABILITY\tVALUE");
            if let Some(caps) = capabilities.as_object() {
                for (name, value) in caps {
                    println!("{name}\t{value}");
                }
            }
            println!("\nCONTROL\tWHILE A TURN RUNS");
            let controls = serde_json::to_value(live_controls).map_err(|e| e.to_string())?;
            for (name, value) in controls.as_object().ok_or("invalid live controls")? {
                println!("{name}\t{}", value.as_str().unwrap_or_default());
            }
            println!("\nMODES");
            if let Some(modes) = modes["modes"].as_array() {
                for mode in modes {
                    println!(
                        "{}\t{}",
                        mode["id"].as_str().unwrap_or_default(),
                        mode["name"].as_str().unwrap_or_default()
                    );
                }
            }
            println!("\nOPTIONS ({options_source})");
            for option in options {
                println!(
                    "{}\t{}\t{}",
                    option["id"].as_str().unwrap_or_default(),
                    option["name"].as_str().unwrap_or_default(),
                    option["options"]
                );
                if option["valuesSource"] == "model ls" {
                    println!("  Values: carbon model ls --harness {}", harness.harness);
                }
            }
        }
        DiscoveryData::Models {
            harness,
            models,
            total,
            next_cursor,
            catalog_reason,
        } => {
            println!("MODEL\tALIAS\tPROVIDER\tEFFORTS\tDEFAULT EFFORT\tFAST");
            for model in &models {
                let levels = model["efforts"]
                    .as_array()
                    .map(|a| {
                        a.iter()
                            .filter_map(|v| v.as_str())
                            .collect::<Vec<_>>()
                            .join(",")
                    })
                    .unwrap_or_default();
                println!(
                    "{}\t{}\t{}\t{}\t{}\t{}",
                    model["label"].as_str().unwrap_or_default(),
                    model["arg"].as_str().unwrap_or_default(),
                    model["provider"].as_str().unwrap_or_default(),
                    levels,
                    model["defaultEffort"].as_str().unwrap_or("none"),
                    model["supportsFast"].as_bool().unwrap_or(false)
                );
            }
            eprintln!(
                "{}: {} of {total} matching models.",
                harness.harness,
                models.len()
            );
            if let Some(reason) = catalog_reason {
                eprintln!("{reason}");
            }
            if let Some(cursor) = next_cursor {
                eprintln!("Next page: pass --cursor {cursor} with the same --harness and --query.");
            }
        }
    }
    Ok(())
}
