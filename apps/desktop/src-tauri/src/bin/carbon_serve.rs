//! `carbon-serve [--port N | --version]`: Carbon's core with no window. See
//! SERVE-PLAN.md.

const DEFAULT_PORT: u16 = carbon_proto::SERVE_PORT;

#[tokio::main]
async fn main() {
    if std::env::args().nth(1).as_deref() == Some("--mcp-bridge") {
        let result = match std::env::args().nth(2) {
            Some(url) => ade_lib::mcp::bridge::run(&url).await,
            None => Err(anyhow::anyhow!("missing MCP endpoint")),
        };
        if let Err(error) = result { eprintln!("carbon MCP bridge: {error:#}"); std::process::exit(1); }
        return;
    }
    // What `carbon update` compares the installer's pick against, since beside
    // the Mac app the `carbon` next to this one no longer says what it is.
    if std::env::args().nth(1).as_deref() == Some("--version") {
        println!("carbon-serve {}", option_env!("CARBON_CLI_VERSION").unwrap_or("dev"));
        return;
    }
    let mut args = std::env::args().skip(1);
    let mut port = DEFAULT_PORT;
    while let Some(arg) = args.next() {
        match (arg.as_str(), args.next().map(|v| v.parse())) {
            ("--port", Some(Ok(p))) => port = p,
            _ => {
                eprintln!("usage: carbon-serve [--port N]   (default {DEFAULT_PORT}; 0 picks one)");
                std::process::exit(2);
            }
        }
    }

    ade_lib::analytics::install_panic_hook();
    if let Err(e) = ade_lib::serve::run(port).await {
        eprintln!("carbon-serve: {e:#}");
        std::process::exit(1);
    }
}
