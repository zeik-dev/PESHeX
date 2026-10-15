//! Consulta del ultimo Release de GitHub y eleccion del zip de Windows.

use crate::http::Http;
use crate::version::Version;
use crate::{Result, UpdateError};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone)]
pub struct Config {
    pub api_base: String,
    /// `dueño/repositorio`
    pub repo: String,
}

impl Default for Config {
    fn default() -> Self {
        Config { api_base: "https://api.github.com".into(), repo: crate::REPO.into() }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Asset {
    pub name: String,
    pub url: String,
    pub size: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseInfo {
    pub tag: String,
    /// Sin la `v`: `1.2.0`
    pub version: String,
    pub name: String,
    /// Notas del Release (Markdown).
    pub notes: String,
    pub url: String,
    pub published_at: Option<String>,
    pub prerelease: bool,
    pub asset: Asset,
    pub sums_url: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum CheckReport {
    UpToDate { current: String, latest: String },
    Available { release: Box<ReleaseInfo> },
    Error { code: String, message: String },
}

pub const SUMS_NAME: &str = "SHA256SUMS.txt";
const MAX_JSON: u64 = 4 * 1024 * 1024;

/// Nombre del zip de un Release: `PESHeX-<version>-windows-x64.zip`.
pub fn asset_name(version: &str) -> String {
    format!("PESHeX-{version}-windows-x64.zip")
}

/// Lee el JSON de `releases/latest` y elige el zip y las huellas. No decide si es mas nuevo.
pub fn parse_release(json: &str) -> Result<ReleaseInfo> {
    let v: serde_json::Value = serde_json::from_str(json).map_err(|e| UpdateError::Invalid(format!("JSON de GitHub no valido: {e}")))?;
    let text = |k: &str| v.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string();
    let tag = text("tag_name");
    let version = Version::parse(&tag).ok_or_else(|| UpdateError::Invalid(format!("el tag «{tag}» no es una version")))?;
    if v.get("draft").and_then(|d| d.as_bool()).unwrap_or(false) {
        return Err(UpdateError::NoRelease);
    }
    let want = asset_name(&version.to_string());
    let assets = v.get("assets").and_then(|a| a.as_array()).cloned().unwrap_or_default();
    let find = |name: &str| {
        assets.iter().find(|a| a.get("name").and_then(|n| n.as_str()) == Some(name)).map(|a| {
            (
                a.get("browser_download_url").and_then(|u| u.as_str()).unwrap_or("").to_string(),
                a.get("size").and_then(|s| s.as_u64()).unwrap_or(0),
            )
        })
    };
    let (url, size) = find(&want).filter(|(u, _)| !u.is_empty()).ok_or_else(|| UpdateError::NoAsset(want.clone()))?;
    let (sums_url, _) = find(SUMS_NAME).filter(|(u, _)| !u.is_empty()).ok_or_else(|| UpdateError::NoChecksum(want.clone()))?;
    let name = text("name");
    Ok(ReleaseInfo {
        tag: tag.clone(),
        version: version.to_string(),
        name: if name.is_empty() { tag } else { name },
        notes: text("body"),
        url: text("html_url"),
        published_at: v.get("published_at").and_then(|p| p.as_str()).map(String::from),
        prerelease: v.get("prerelease").and_then(|p| p.as_bool()).unwrap_or(false),
        asset: Asset { name: want, url, size },
        sums_url,
    })
}

/// Consulta el ultimo Release y lo compara con `current`. Nunca propone bajar de version.
pub fn check(http: &Http, cfg: &Config, current: &str) -> Result<CheckReport> {
    let current_v = Version::parse(current).ok_or_else(|| UpdateError::Invalid(format!("version actual no valida: {current}")))?;
    let url = format!("{}/repos/{}/releases/latest", cfg.api_base.trim_end_matches('/'), cfg.repo);
    let json = http.get_text(&url, Some("application/vnd.github+json"), MAX_JSON)?;
    let latest_v = Version::parse(
        serde_json::from_str::<serde_json::Value>(&json)
            .ok()
            .and_then(|v| v.get("tag_name").and_then(|t| t.as_str()).map(String::from))
            .as_deref()
            .unwrap_or(""),
    )
    .ok_or_else(|| UpdateError::Invalid("el ultimo Release no tiene un tag de version".into()))?;
    if latest_v <= current_v {
        return Ok(CheckReport::UpToDate { current: current_v.to_string(), latest: latest_v.to_string() });
    }
    Ok(CheckReport::Available { release: Box::new(parse_release(&json)?) })
}

/// Como `check`, pero los errores van dentro del informe (el proceso `check` siempre imprime un JSON).
pub fn check_report(http: &Http, cfg: &Config, current: &str) -> CheckReport {
    check(http, cfg, current).unwrap_or_else(|e| CheckReport::Error { code: e.code().into(), message: e.to_string() })
}

#[cfg(test)]
mod tests {
    use super::*;

    pub(crate) fn sample(tag: &str) -> String {
        let v = tag.trim_start_matches('v');
        format!(
            r#"{{"tag_name":"{tag}","name":"PESHeX {v}","body":"Novedades\n- algo","html_url":"https://github.com/zeik-dev/PESHeX/releases/tag/{tag}",
            "published_at":"2026-10-15T10:00:00Z","prerelease":false,"draft":false,"assets":[
            {{"name":"PESHeX-{v}-windows-x64.zip","browser_download_url":"https://github.com/zeik-dev/PESHeX/releases/download/{tag}/PESHeX-{v}-windows-x64.zip","size":1234}},
            {{"name":"SHA256SUMS.txt","browser_download_url":"https://github.com/zeik-dev/PESHeX/releases/download/{tag}/SHA256SUMS.txt","size":90}}]}}"#
        )
    }

    #[test]
    fn elige_el_zip_y_las_huellas() {
        let r = parse_release(&sample("v1.2.0")).unwrap();
        assert_eq!(r.version, "1.2.0");
        assert_eq!(r.asset.name, "PESHeX-1.2.0-windows-x64.zip");
        assert_eq!(r.asset.size, 1234);
        assert!(r.sums_url.ends_with("/SHA256SUMS.txt"));
        assert!(r.notes.contains("Novedades"));
        assert!(!r.prerelease);
    }

    #[test]
    fn sin_zip_o_sin_huellas_es_error() {
        let no_zip = sample("v1.2.0").replace("windows-x64.zip\",\"browser", "linux.zip\",\"browser");
        assert!(matches!(parse_release(&no_zip), Err(UpdateError::NoAsset(_))));
        let no_sums = sample("v1.2.0").replace("SHA256SUMS.txt\",\"browser", "OTRA.txt\",\"browser");
        assert!(matches!(parse_release(&no_sums), Err(UpdateError::NoChecksum(_))));
        assert!(matches!(parse_release(&sample("v1.2.0").replace("\"draft\":false", "\"draft\":true")), Err(UpdateError::NoRelease)));
        assert!(parse_release("{").is_err());
        assert!(parse_release(&sample("nightly")).is_err());
    }

    #[test]
    fn el_informe_se_serializa_en_camel_case() {
        let r = parse_release(&sample("v1.2.0")).unwrap();
        let j = serde_json::to_value(CheckReport::Available { release: Box::new(r) }).unwrap();
        assert_eq!(j["status"], "available");
        assert_eq!(j["release"]["sumsUrl"], "https://github.com/zeik-dev/PESHeX/releases/download/v1.2.0/SHA256SUMS.txt");
        assert_eq!(j["release"]["publishedAt"], "2026-10-15T10:00:00Z");
        let j = serde_json::to_value(CheckReport::UpToDate { current: "1.2.0".into(), latest: "1.2.0".into() }).unwrap();
        assert_eq!(j["status"], "upToDate");
    }
}
