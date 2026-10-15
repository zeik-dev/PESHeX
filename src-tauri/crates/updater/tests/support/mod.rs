//! Utilidades de las pruebas: servidor HTTP/1.1 local (std puro) con soporte de `Range`, redirecciones, cortes y envio lento.

#![allow(dead_code)]

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

#[derive(Debug, Clone)]
pub struct Request {
    pub path: String,
    pub headers: Vec<(String, String)>,
}

impl Request {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers.iter().find(|(k, _)| k.eq_ignore_ascii_case(name)).map(|(_, v)| v.as_str())
    }
    /// Inicio pedido en `Range: bytes=N-`.
    pub fn range_from(&self) -> Option<u64> {
        self.header("range")?.strip_prefix("bytes=")?.trim_end_matches('-').parse().ok()
    }
}

pub enum Reply {
    /// Respuesta completa de una vez.
    Full { status: u16, headers: Vec<(String, String)>, body: Vec<u8> },
    /// Cuerpo enviado a trozos con pausa entre ellos; `cut_after` corta la conexion tras esos bytes (sin terminar).
    Stream { status: u16, headers: Vec<(String, String)>, body: Vec<u8>, chunk: usize, delay: Duration, cut_after: Option<usize> },
}

impl Reply {
    pub fn text(status: u16, body: &str) -> Reply {
        Reply::Full { status, headers: vec![], body: body.as_bytes().to_vec() }
    }
    pub fn redirect(to: &str) -> Reply {
        Reply::Full { status: 302, headers: vec![("Location".into(), to.into())], body: vec![] }
    }
    /// Sirve `data` respetando `Range: bytes=N-` (206) o entero (200). `ignore_range` simula un servidor sin soporte.
    pub fn bytes(req: &Request, data: &[u8], chunk: usize, delay: Duration, cut_after: Option<usize>, ignore_range: bool) -> Reply {
        let from = if ignore_range { None } else { req.range_from() };
        match from {
            Some(f) if f as usize >= data.len() => Reply::Full {
                status: 416,
                headers: vec![("Content-Range".into(), format!("bytes */{}", data.len()))],
                body: vec![],
            },
            Some(f) => Reply::Stream {
                status: 206,
                headers: vec![("Content-Range".into(), format!("bytes {}-{}/{}", f, data.len() - 1, data.len()))],
                body: data[f as usize..].to_vec(),
                chunk,
                delay,
                cut_after,
            },
            None => Reply::Stream { status: 200, headers: vec![], body: data.to_vec(), chunk, delay, cut_after },
        }
    }
}

pub struct Server {
    pub addr: SocketAddr,
    pub hits: Arc<AtomicUsize>,
    pub log: Arc<Mutex<Vec<Request>>>,
}

impl Server {
    pub fn url(&self, path: &str) -> String {
        format!("http://{}{}", self.addr, path)
    }
    pub fn requests(&self) -> Vec<Request> {
        self.log.lock().unwrap().clone()
    }
}

pub fn serve(handler: impl Fn(&Request, usize) -> Reply + Send + Sync + 'static) -> Server {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    let hits = Arc::new(AtomicUsize::new(0));
    let log = Arc::new(Mutex::new(Vec::new()));
    let handler = Arc::new(handler);
    let (h2, l2) = (hits.clone(), log.clone());
    thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(stream) = stream else { continue };
            let (handler, hits, log) = (handler.clone(), h2.clone(), l2.clone());
            thread::spawn(move || {
                let _ = handle(stream, &*handler, &hits, &log);
            });
        }
    });
    Server { addr, hits, log }
}

fn handle(stream: TcpStream, handler: &dyn Fn(&Request, usize) -> Reply, hits: &AtomicUsize, log: &Mutex<Vec<Request>>) -> std::io::Result<()> {
    let mut reader = BufReader::new(stream.try_clone()?);
    let mut first = String::new();
    reader.read_line(&mut first)?;
    let path = first.split_whitespace().nth(1).unwrap_or("/").to_string();
    let mut headers = Vec::new();
    loop {
        let mut line = String::new();
        reader.read_line(&mut line)?;
        let line = line.trim_end();
        if line.is_empty() {
            break;
        }
        if let Some((k, v)) = line.split_once(':') {
            headers.push((k.trim().to_string(), v.trim().to_string()));
        }
    }
    let req = Request { path, headers };
    let n = hits.fetch_add(1, Ordering::SeqCst);
    log.lock().unwrap().push(req.clone());
    let mut out = stream;
    let head = |status: u16, headers: &[(String, String)], len: usize| {
        let mut s = format!("HTTP/1.1 {status} X\r\nContent-Length: {len}\r\nConnection: close\r\n");
        for (k, v) in headers {
            s.push_str(&format!("{k}: {v}\r\n"));
        }
        s.push_str("\r\n");
        s
    };
    match handler(&req, n) {
        Reply::Full { status, headers, body } => {
            out.write_all(head(status, &headers, body.len()).as_bytes())?;
            out.write_all(&body)?;
        }
        Reply::Stream { status, headers, body, chunk, delay, cut_after } => {
            // Se anuncia el tamaño completo aunque luego se corte: asi el cliente nota el cierre prematuro.
            out.write_all(head(status, &headers, body.len()).as_bytes())?;
            let mut sent = 0;
            for piece in body.chunks(chunk.max(1)) {
                if let Some(cut) = cut_after {
                    if sent >= cut {
                        return Ok(()); // se cierra sin mas
                    }
                }
                out.write_all(piece)?;
                out.flush()?;
                sent += piece.len();
                thread::sleep(delay);
            }
        }
    }
    let _ = out.flush();
    let _ = reader.read(&mut [0u8; 1]); // evita un RST antes de que el cliente lea todo
    Ok(())
}

/// Datos de prueba reproducibles (no comprimibles trivialmente).
pub fn blob(len: usize) -> Vec<u8> {
    let mut x: u32 = 0x1234_5678;
    (0..len)
        .map(|_| {
            x ^= x << 13;
            x ^= x >> 17;
            x ^= x << 5;
            (x >> 8) as u8
        })
        .collect()
}

/// Crea un zip con `(nombre, contenido)`.
pub fn make_zip(path: &std::path::Path, files: &[(&str, &[u8])]) {
    use zip::write::SimpleFileOptions;
    let mut w = zip::ZipWriter::new(std::fs::File::create(path).unwrap());
    for (name, data) in files {
        if name.ends_with('/') {
            w.add_directory(*name, SimpleFileOptions::default()).unwrap();
        } else {
            w.start_file(*name, SimpleFileOptions::default()).unwrap();
            w.write_all(data).unwrap();
        }
    }
    w.finish().unwrap();
}
