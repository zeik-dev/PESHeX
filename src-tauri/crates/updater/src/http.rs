//! Cliente HTTP minimo: solo habla con GitHub (https), sigue las redirecciones A MANO comprobando cada salto y nunca envia credenciales.

use crate::{Result, UpdateError};
use std::io::Read;
use std::time::Duration;

/// A que servidores se permite conectar. En produccion: `github.com`, `api.github.com` y `*.githubusercontent.com`, siempre por https.
#[derive(Debug, Clone)]
pub struct HostPolicy {
    exact: Vec<String>,
    suffixes: Vec<String>,
    allow_http: bool,
}

impl HostPolicy {
    pub fn github() -> Self {
        HostPolicy {
            exact: vec!["github.com".into(), "api.github.com".into()],
            suffixes: vec![".githubusercontent.com".into()],
            allow_http: false,
        }
    }

    /// SOLO para las pruebas: servidor local por http.
    pub fn local_for_tests() -> Self {
        HostPolicy { exact: vec!["127.0.0.1".into(), "localhost".into()], suffixes: vec![], allow_http: true }
    }

    pub fn check(&self, url: &str) -> Result<()> {
        let bad = || UpdateError::HostNotAllowed(url.to_string());
        let (scheme, host) = parts(url).ok_or_else(bad)?;
        if scheme != "https" && !(self.allow_http && scheme == "http") {
            return Err(bad());
        }
        let ok = self.exact.iter().any(|h| *h == host) || self.suffixes.iter().any(|s| host.ends_with(s.as_str()) && host.len() > s.len());
        if ok {
            Ok(())
        } else {
            Err(bad())
        }
    }
}

/// `(esquema, host en minusculas)`; `None` si la URL lleva usuario, IPv6, esta vacia o no es http(s).
fn parts(url: &str) -> Option<(&str, String)> {
    let (scheme, rest) = url.split_once("://")?;
    if scheme != "http" && scheme != "https" {
        return None;
    }
    let authority = rest.split(['/', '?', '#']).next()?;
    if authority.is_empty() || authority.contains('@') || authority.starts_with('[') || authority.contains('\\') {
        return None;
    }
    let host = authority.rsplit_once(':').map_or(authority, |(h, port)| if port.bytes().all(|b| b.is_ascii_digit()) { h } else { authority });
    if host.is_empty() {
        return None;
    }
    Some((scheme, host.to_ascii_lowercase()))
}

/// Resuelve el `Location` de una redireccion contra la URL actual (absoluto o con ruta absoluta).
fn resolve(base: &str, location: &str) -> Option<String> {
    if location.starts_with("https://") || location.starts_with("http://") {
        return Some(location.to_string());
    }
    let (scheme, rest) = base.split_once("://")?;
    let authority = rest.split(['/', '?', '#']).next()?;
    if let Some(path) = location.strip_prefix('/') {
        if path.starts_with('/') {
            return None; // «//host/...»: no se admite
        }
        return Some(format!("{scheme}://{authority}/{path}"));
    }
    None
}

pub struct Http {
    agent: ureq::Agent,
    policy: HostPolicy,
}

const MAX_REDIRECTS: usize = 6;

impl Http {
    pub fn new(policy: HostPolicy) -> Self {
        let agent = ureq::AgentBuilder::new()
            .redirects(0) // las redirecciones se siguen a mano, validando cada host
            .timeout_connect(Duration::from_secs(15))
            .timeout_read(Duration::from_secs(20))
            .timeout_write(Duration::from_secs(20))
            .user_agent(&format!("PESHeX-Updater/{} (+https://github.com/zeik-dev/PESHeX)", crate::VERSION))
            .build();
        Http { agent, policy }
    }

    /// GET con `Range: bytes=<from>-` opcional. Devuelve la respuesta final (2xx); 4xx/5xx son `Err`.
    pub fn get(&self, url: &str, range_from: Option<u64>, accept: Option<&str>) -> Result<ureq::Response> {
        let mut current = url.to_string();
        for _ in 0..=MAX_REDIRECTS {
            self.policy.check(&current)?;
            let mut req = self.agent.get(&current);
            if let Some(a) = accept {
                req = req.set("Accept", a);
            }
            if let Some(from) = range_from.filter(|f| *f > 0) {
                req = req.set("Range", &format!("bytes={from}-"));
            }
            let resp = match req.call() {
                Ok(r) => r,
                Err(ureq::Error::Status(code, resp)) => return Err(status_error(code, &resp)),
                Err(ureq::Error::Transport(t)) => return Err(UpdateError::Network(t.to_string())),
            };
            if (300..400).contains(&resp.status()) && resp.status() != 304 {
                let location = resp.header("location").ok_or(UpdateError::Http(resp.status()))?;
                current = resolve(&current, location).ok_or_else(|| UpdateError::HostNotAllowed(location.to_string()))?;
                continue;
            }
            return Ok(resp);
        }
        Err(UpdateError::Network("demasiadas redirecciones".into()))
    }

    /// Descarga un recurso pequeño (JSON, huellas) como texto, con un tope de tamaño.
    pub fn get_text(&self, url: &str, accept: Option<&str>, max_bytes: u64) -> Result<String> {
        let resp = self.get(url, None, accept)?;
        let mut body = Vec::new();
        resp.into_reader().take(max_bytes + 1).read_to_end(&mut body).map_err(|e| UpdateError::Network(e.to_string()))?;
        if body.len() as u64 > max_bytes {
            return Err(UpdateError::Invalid("respuesta demasiado grande".into()));
        }
        String::from_utf8(body).map_err(|_| UpdateError::Invalid("la respuesta no es texto UTF-8".into()))
    }
}

fn status_error(code: u16, resp: &ureq::Response) -> UpdateError {
    match code {
        404 => UpdateError::NoRelease,
        429 => UpdateError::RateLimited,
        403 if resp.header("x-ratelimit-remaining") == Some("0") || resp.header("retry-after").is_some() => UpdateError::RateLimited,
        _ => UpdateError::Http(code),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn solo_github_por_https() {
        let p = HostPolicy::github();
        for ok in [
            "https://api.github.com/repos/zeik-dev/PESHeX/releases/latest",
            "https://github.com/zeik-dev/PESHeX/releases/download/v1.2.0/a.zip",
            "https://objects.githubusercontent.com/github-production-release-asset/x?sig=1",
            "https://release-assets.githubusercontent.com/a",
            "https://GitHub.com:443/x",
        ] {
            assert!(p.check(ok).is_ok(), "{ok}");
        }
        for bad in [
            "http://api.github.com/x",
            "https://evil.com/x",
            "https://github.com.evil.com/x",
            "https://evilgithub.com/x",
            "https://githubusercontent.com/x",
            "https://user@github.com/x",
            "https://github.com@evil.com/x",
            "https://[::1]/x",
            "ftp://github.com/x",
            "file:///etc/passwd",
            "github.com/x",
            "https:///x",
        ] {
            assert!(matches!(p.check(bad), Err(UpdateError::HostNotAllowed(_))), "{bad}");
        }
    }

    #[test]
    fn resuelve_redirecciones_relativas() {
        assert_eq!(resolve("https://github.com/a/b", "/c/d?x=1").as_deref(), Some("https://github.com/c/d?x=1"));
        assert_eq!(resolve("https://github.com/a/b", "https://objects.githubusercontent.com/z").as_deref(), Some("https://objects.githubusercontent.com/z"));
        assert!(resolve("https://github.com/a", "//evil.com/x").is_none());
        assert!(resolve("https://github.com/a", "relativa").is_none());
    }
}
