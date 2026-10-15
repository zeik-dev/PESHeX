//! `PESHeX-Updater`: ver `peshex_updater::session`.
//!
//!   PESHeX-Updater --version
//!   PESHeX-Updater check --current 1.1.0   -> imprime UN objeto JSON (`upToDate` | `available` | `error`) y sale con 0
//!   PESHeX-Updater run                      -> protocolo de una actualizacion por stdin/stdout

use peshex_updater::github::{self, Config};
use peshex_updater::http::{HostPolicy, Http};
use peshex_updater::session::{self, Emit, Env, Event};
use std::io::{BufReader, Write};
use std::sync::{Arc, Mutex};

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("--version") | Some("-V") => println!("PESHeX-Updater {}", peshex_updater::VERSION),
        Some("check") => {
            let current = args.iter().position(|a| a == "--current").and_then(|i| args.get(i + 1)).map(String::as_str).unwrap_or("");
            let report = github::check_report(&Http::new(HostPolicy::github()), &Config::default(), current);
            println!("{}", serde_json::to_string(&report).unwrap_or_else(|_| "{\"status\":\"error\",\"code\":\"invalid\",\"message\":\"\"}".into()));
        }
        Some("run") => {
            let out = Arc::new(Mutex::new(std::io::stdout()));
            let emit: Emit = Arc::new(move |ev: &Event| {
                if let (Ok(line), Ok(mut o)) = (serde_json::to_string(ev), out.lock()) {
                    // Si la app ya cerro la tuberia (esta instalando y se esta cerrando) no pasa nada.
                    let _ = writeln!(o, "{line}");
                    let _ = o.flush();
                }
            });
            std::process::exit(session::run(BufReader::new(std::io::stdin()), emit, Env::production()));
        }
        _ => {
            eprintln!("uso: PESHeX-Updater --version | check --current <X.Y.Z> | run");
            std::process::exit(2);
        }
    }
}
