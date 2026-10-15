//! Politica de hosts, redirecciones y consulta del ultimo Release contra un servidor local.

mod support;

use peshex_updater::github::{self, CheckReport, Config};
use peshex_updater::http::{HostPolicy, Http};
use peshex_updater::UpdateError;
use support::{serve, Reply};

fn release_json(tag: &str) -> String {
    let v = tag.trim_start_matches('v');
    format!(
        r#"{{"tag_name":"{tag}","name":"PESHeX {v}","body":"Notas","html_url":"https://github.com/zeik-dev/PESHeX/releases/tag/{tag}","published_at":"2026-10-15T10:00:00Z",
        "prerelease":false,"draft":false,"assets":[
        {{"name":"PESHeX-{v}-windows-x64.zip","browser_download_url":"https://github.com/zeik-dev/PESHeX/releases/download/{tag}/PESHeX-{v}-windows-x64.zip","size":1000}},
        {{"name":"SHA256SUMS.txt","browser_download_url":"https://github.com/zeik-dev/PESHeX/releases/download/{tag}/SHA256SUMS.txt","size":90}}]}}"#
    )
}

fn local() -> Http {
    Http::new(HostPolicy::local_for_tests())
}

fn cfg(base: String) -> Config {
    Config { api_base: base, repo: "zeik-dev/PESHeX".into() }
}

#[test]
fn hay_una_version_nueva() {
    let s = serve(|req, _| {
        assert_eq!(req.path, "/repos/zeik-dev/PESHeX/releases/latest");
        assert_eq!(req.header("accept"), Some("application/vnd.github+json"));
        assert!(req.header("user-agent").unwrap_or("").starts_with("PESHeX-Updater/"), "GitHub exige User-Agent");
        assert!(req.header("authorization").is_none(), "nunca se envian credenciales");
        Reply::text(200, &release_json("v1.2.0"))
    });
    match github::check(&local(), &cfg(format!("http://{}", s.addr)), "1.1.0").unwrap() {
        CheckReport::Available { release } => {
            assert_eq!(release.version, "1.2.0");
            assert_eq!(release.asset.name, "PESHeX-1.2.0-windows-x64.zip");
        }
        other => panic!("{other:?}"),
    }
}

#[test]
fn al_dia_y_nunca_baja_de_version() {
    let s = serve(|_, _| Reply::text(200, &release_json("v1.2.0")));
    let c = cfg(format!("http://{}", s.addr));
    for current in ["1.2.0", "1.3.0", "2.0.0-beta.1"] {
        assert!(matches!(github::check(&local(), &c, current).unwrap(), CheckReport::UpToDate { .. }), "{current}");
    }
    // Una prerelease de la misma version es anterior a la final: si hay final, se ofrece.
    assert!(matches!(github::check(&local(), &c, "1.2.0-rc.1").unwrap(), CheckReport::Available { .. }));
}

#[test]
fn errores_de_github_se_distinguen() {
    let s404 = serve(|_, _| Reply::text(404, "{}"));
    assert!(matches!(github::check(&local(), &cfg(format!("http://{}", s404.addr)), "1.0.0"), Err(UpdateError::NoRelease)));

    let limited = serve(|_, _| Reply::Full { status: 403, headers: vec![("x-ratelimit-remaining".into(), "0".into())], body: b"{}".to_vec() });
    assert!(matches!(github::check(&local(), &cfg(format!("http://{}", limited.addr)), "1.0.0"), Err(UpdateError::RateLimited)));

    let boom = serve(|_, _| Reply::text(500, "x"));
    assert!(matches!(github::check(&local(), &cfg(format!("http://{}", boom.addr)), "1.0.0"), Err(UpdateError::Http(500))));

    // El informe de `check` nunca falla: el error va dentro con su codigo.
    let rep = github::check_report(&local(), &cfg(format!("http://{}", limited.addr)), "1.0.0");
    assert_eq!(serde_json::to_value(rep).unwrap()["code"], "rate_limited");
}

#[test]
fn sin_conexion_es_error_de_red() {
    let port = {
        let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        l.local_addr().unwrap().port()
    }; // el puerto queda libre y sin escuchar
    let r = github::check(&local(), &cfg(format!("http://127.0.0.1:{port}")), "1.0.0");
    assert!(matches!(r, Err(UpdateError::Network(_))), "{r:?}");
}

#[test]
fn las_redirecciones_se_siguen_dentro_de_la_politica() {
    let target = serve(|_, _| Reply::text(200, "destino"));
    let t = target.addr;
    let s = serve(move |req, _| match req.path.as_str() {
        "/a" => Reply::redirect("/b"),
        "/b" => Reply::redirect(&format!("http://{t}/fin")),
        _ => Reply::text(404, ""),
    });
    let body = local().get_text(&format!("http://{}/a", s.addr), None, 1000).unwrap();
    assert_eq!(body, "destino");
}

#[test]
fn una_redireccion_a_otro_host_se_rechaza() {
    let s = serve(|_, _| Reply::redirect("http://evil.example/robar"));
    let r = local().get_text(&format!("http://{}/x", s.addr), None, 1000);
    assert!(matches!(r, Err(UpdateError::HostNotAllowed(_))), "{r:?}");
    // Y con la politica real ni siquiera se conecta a un servidor local.
    let r = Http::new(HostPolicy::github()).get_text(&format!("http://{}/x", s.addr), None, 1000);
    assert!(matches!(r, Err(UpdateError::HostNotAllowed(_))));
    assert_eq!(s.hits.load(std::sync::atomic::Ordering::SeqCst), 1, "solo la primera prueba llego al servidor");
}

#[test]
fn bucle_de_redirecciones_se_corta() {
    let s = serve(|_, _| Reply::redirect("/otra"));
    let r = local().get_text(&format!("http://{}/x", s.addr), None, 1000);
    assert!(matches!(r, Err(UpdateError::Network(_))), "{r:?}");
}

#[test]
fn respuesta_demasiado_grande_se_rechaza() {
    let s = serve(|_, _| Reply::text(200, &"x".repeat(5000)));
    let r = local().get_text(&format!("http://{}/x", s.addr), None, 1000);
    assert!(matches!(r, Err(UpdateError::Invalid(_))), "{r:?}");
}
