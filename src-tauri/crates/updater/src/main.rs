//! `PESHeX-Updater`: ver `peshex_updater::session`.
//!
//!   PESHeX-Updater --version
//!   PESHeX-Updater check --current 1.1.0 [--log <archivo>]  -> imprime UN objeto JSON (`upToDate` | `available` | `error`) y sale con 0
//!   PESHeX-Updater run                      -> protocolo de una actualizacion por stdin/stdout
//!   PESHeX-Updater apply-local --zip <zip> --app-dir <carpeta> [--no-relaunch] [--wait <segundos>] [--log <archivo>]
//!                                           -> instala un zip YA descargado (sin red): pruebas y recuperacion a mano

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
            if let Some(log) = args.iter().position(|a| a == "--log").and_then(|i| args.get(i + 1)) {
                let (level, what) = match &report {
                    github::CheckReport::Error { code, message } => ("ERROR", format!("{code}: {message}")),
                    github::CheckReport::UpToDate { latest, .. } => ("INFO", format!("al dia (ultima: {latest})")),
                    github::CheckReport::Available { release } => ("INFO", format!("hay una version nueva: {}", release.version)),
                };
                peshex_core::logfile::append(std::path::Path::new(log), level, &format!("[updater] check --current {current}: {what}"));
            }
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
        Some("apply-local") => {
            let get = |flag: &str| args.iter().position(|a| a == flag).and_then(|i| args.get(i + 1)).cloned();
            let (Some(zip), Some(dir)) = (get("--zip"), get("--app-dir")) else {
                eprintln!("uso: PESHeX-Updater apply-local --zip <zip> --app-dir <carpeta> [--no-relaunch] [--wait <segundos>] [--log <archivo>]");
                std::process::exit(2);
            };
            let mut env = Env::production();
            env.relaunch = !args.iter().any(|a| a == "--no-relaunch");
            if let Some(w) = get("--wait").and_then(|w| w.parse::<u64>().ok()) {
                env.apply_wait = std::time::Duration::from_secs(w);
            }
            let log = match get("--log") {
                Some(file) => session::Log::at_file(file.into()),
                None => session::Log::disabled(),
            };
            match session::apply_local(std::path::Path::new(&zip), std::path::Path::new(&dir), &env, &log) {
                Ok(n) => println!("ok: {n} archivos instalados en {dir}"),
                Err(e) => {
                    log.error(&format!("apply-local fallo ({}): {e}", e.code()));
                    eprintln!("error ({}): {e}", e.code());
                    std::process::exit(1);
                }
            }
        }
        _ => {
            eprintln!("uso: PESHeX-Updater --version | check --current <X.Y.Z> [--log <archivo>] | run | apply-local --zip <zip> --app-dir <carpeta>");
            std::process::exit(2);
        }
    }
}
