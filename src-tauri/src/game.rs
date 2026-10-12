//! Carpeta del juego vinculada: escaneo de `Graphics/`, lectura segura de
//! imagenes y mapa manual de assets (`assetmap.json`).
//!
//! PESHeX solo LEE la carpeta del juego del usuario: nunca escribe en ella. El
//! mapa manual se guarda en el directorio de datos de la app, una vez por
//! juego (identificado por un hash de su ruta).

use std::fs;
use std::path::{Component, Path, PathBuf};

use rxdriver::DriverErrorDto;
use serde::Serialize;
use serde_json::Value;
use tauri::ipc::Response;
use tauri::{AppHandle, Manager, State};

use crate::state::AppState;

/// Subcarpetas de `Graphics/` que contienen lo que PESHeX dibuja (el resto:
/// tilesets, charsets, fondos... no hace falta indexarlo).
const RELEVANT_DIRS: &[&str] = &[
    "pokemon", "items", "ui", "pictures", "icons", "battlers", "trainers",
];
const IMAGE_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "gif", "bmp"];
const MAX_FILES: usize = 50_000;
const MAX_DEPTH: usize = 8;
const MAX_IMAGE_BYTES: u64 = 8 * 1024 * 1024;

#[derive(Debug, Serialize, PartialEq)]
pub struct GameScan {
    pub root: String,
    /// Carpeta `Graphics` real (puede variar en mayusculas).
    pub graphics: Option<String>,
    /// `[ruta relativa a la raiz con '/', ancho, alto]` (alto/ancho 0 si no es PNG).
    pub files: Vec<(String, u32, u32)>,
    pub truncated: bool,
}

fn err(kind: &str, msg: impl Into<String>) -> DriverErrorDto {
    DriverErrorDto::new(kind, msg)
}

fn is_image(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| IMAGE_EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

/// Hijo de `dir` con ese nombre sin distinguir mayusculas.
fn child_ci(dir: &Path, name: &str) -> Option<PathBuf> {
    let exact = dir.join(name);
    if exact.exists() {
        return Some(exact);
    }
    fs::read_dir(dir).ok()?.flatten().find_map(|e| {
        let n = e.file_name();
        if n.to_string_lossy().eq_ignore_ascii_case(name) {
            Some(e.path())
        } else {
            None
        }
    })
}

/// Ancho y alto de un PNG leyendo solo la cabecera IHDR.
pub fn png_size(path: &Path) -> Option<(u32, u32)> {
    use std::io::Read;
    let mut buf = [0u8; 24];
    fs::File::open(path).ok()?.read_exact(&mut buf).ok()?;
    if &buf[0..8] != b"\x89PNG\r\n\x1a\n" || &buf[12..16] != b"IHDR" {
        return None;
    }
    let w = u32::from_be_bytes([buf[16], buf[17], buf[18], buf[19]]);
    let h = u32::from_be_bytes([buf[20], buf[21], buf[22], buf[23]]);
    Some((w, h))
}

fn walk(
    base: &Path,
    dir: &Path,
    depth: usize,
    out: &mut Vec<(String, u32, u32)>,
    cap: usize,
) -> bool {
    if depth > MAX_DEPTH {
        return false;
    }
    let Ok(rd) = fs::read_dir(dir) else {
        return false;
    };
    let mut entries: Vec<_> = rd.flatten().collect();
    entries.sort_by_key(|e| e.file_name());
    for e in entries {
        // `file_type` no sigue enlaces: los symlinks se ignoran (evita salir de la carpeta y ciclos).
        let Ok(ft) = e.file_type() else { continue };
        let path = e.path();
        if ft.is_dir() {
            if walk(base, &path, depth + 1, out, cap) {
                return true;
            }
        } else if ft.is_file() && is_image(&path) {
            if out.len() >= cap {
                return true;
            }
            let rel = path
                .strip_prefix(base)
                .map(|p| {
                    p.components()
                        .map(|c| c.as_os_str().to_string_lossy().into_owned())
                        .collect::<Vec<_>>()
                        .join("/")
                })
                .unwrap_or_default();
            let (w, h) = png_size(&path).unwrap_or((0, 0));
            out.push((rel, w, h));
        }
    }
    false
}

/// Recorre las carpetas relevantes de `Graphics/` de la raiz del juego.
pub fn scan_graphics(root: &Path, cap: usize) -> Result<GameScan, DriverErrorDto> {
    if !root.is_dir() {
        return Err(err(
            "GameFolderInvalid",
            format!("no existe la carpeta '{}'", root.display()),
        ));
    }
    let graphics = child_ci(root, "Graphics").filter(|g| g.is_dir());
    let mut files = Vec::new();
    let mut truncated = false;
    if let Some(g) = &graphics {
        for name in RELEVANT_DIRS {
            if let Some(sub) = child_ci(g, name).filter(|p| p.is_dir()) {
                if walk(root, &sub, 0, &mut files, cap) {
                    truncated = true;
                    break;
                }
            }
        }
    }
    files.sort_by(|a, b| a.0.cmp(&b.0));
    Ok(GameScan {
        root: root.to_string_lossy().into_owned(),
        graphics: graphics.map(|g| g.to_string_lossy().into_owned()),
        files,
        truncated,
    })
}

/// Valida una ruta relativa pedida por la UI y la resuelve DENTRO de `root`.
/// Rechaza rutas absolutas, `..`, extensiones que no son imagen, symlinks que
/// salgan de la carpeta y archivos demasiado grandes.
pub fn resolve_game_file(root: &Path, rel: &str) -> Result<PathBuf, DriverErrorDto> {
    let rel_path = Path::new(rel);
    let bad_component = rel_path.components().any(|c| {
        matches!(
            c,
            Component::ParentDir | Component::RootDir | Component::Prefix(_)
        )
    });
    if rel.is_empty() || rel.contains('\0') || bad_component || rel_path.is_absolute() {
        return Err(err("InvalidPath", "ruta no permitida"));
    }
    if !is_image(rel_path) {
        return Err(err("InvalidPath", "solo se pueden leer imagenes"));
    }
    let canon_root = root
        .canonicalize()
        .map_err(|e| err("GameFolderInvalid", format!("carpeta del juego no disponible: {e}")))?;
    let full = canon_root
        .join(rel_path)
        .canonicalize()
        .map_err(|e| err("FileNotFound", format!("no se encontro '{rel}': {e}")))?;
    if !full.starts_with(&canon_root) {
        return Err(err("InvalidPath", "la ruta sale de la carpeta del juego"));
    }
    let meta = fs::metadata(&full).map_err(|e| err("FileNotFound", e.to_string()))?;
    if !meta.is_file() {
        return Err(err("FileNotFound", format!("'{rel}' no es un archivo")));
    }
    if meta.len() > MAX_IMAGE_BYTES {
        return Err(err("FileTooLarge", format!("'{rel}' supera {MAX_IMAGE_BYTES} bytes")));
    }
    Ok(full)
}

/// FNV-1a de 64 bits (estable entre ejecuciones y versiones, a diferencia de `DefaultHasher`).
pub fn fnv1a64(s: &str) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in s.as_bytes() {
        h ^= u64::from(*b);
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    h
}

/// `<datos de la app>/assetmaps/<hash de la ruta del juego>.json`
pub fn assetmap_path(data_dir: &Path, root: &str) -> PathBuf {
    let key = root.replace('\\', "/").trim_end_matches('/').to_lowercase();
    data_dir
        .join("assetmaps")
        .join(format!("{:016x}.json", fnv1a64(&key)))
}

pub fn read_assetmap(path: &Path) -> Result<Option<Value>, DriverErrorDto> {
    match fs::read_to_string(path) {
        Ok(text) => serde_json::from_str(&text)
            .map(Some)
            .map_err(|e| err("AssetMapCorrupt", format!("assetmap.json invalido: {e}"))),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(err("Io", e.to_string())),
    }
}

pub fn write_assetmap(path: &Path, map: &Value) -> Result<(), DriverErrorDto> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| err("Io", e.to_string()))?;
    }
    let text = serde_json::to_string_pretty(map).map_err(|e| err("Io", e.to_string()))?;
    // Escritura atomica: nunca deja un JSON a medias si se corta.
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, text).map_err(|e| err("Io", e.to_string()))?;
    fs::rename(&tmp, path).map_err(|e| err("Io", e.to_string()))
}

fn data_dir(app: &AppHandle) -> Result<PathBuf, DriverErrorDto> {
    app.path()
        .app_data_dir()
        .map_err(|e| err("AppDataDir", format!("no se pudo resolver el directorio de datos: {e}")))
}

// ── Comandos ─────────────────────────────────────────────────────────────────

/// Escanea `Graphics/` y concede al asset protocol acceso de LECTURA solo a esa
/// carpeta (el scope arranca vacio). Recuerda la raiz para `read_game_file`.
#[tauri::command]
pub async fn scan_game_folder(
    app: AppHandle,
    state: State<'_, AppState>,
    root: String,
) -> Result<GameScan, DriverErrorDto> {
    let root_path = PathBuf::from(&root);
    let scan = tauri::async_runtime::spawn_blocking(move || scan_graphics(&root_path, MAX_FILES))
        .await
        .map_err(|e| err("Internal", e.to_string()))??;
    if let Some(g) = &scan.graphics {
        // El scope del asset protocol es de solo lectura y solo cubre Graphics/.
        app.asset_protocol_scope()
            .allow_directory(g, true)
            .map_err(|e| err("AssetScope", e.to_string()))?;
    }
    *state.game_root.lock().unwrap() = Some(PathBuf::from(&root));
    Ok(scan)
}

/// Libera la carpeta vinculada (la UI la llama al desvincular).
#[tauri::command]
pub fn forget_game_folder(state: State<'_, AppState>) {
    *state.game_root.lock().unwrap() = None;
}

/// Plan B del asset protocol: devuelve los bytes de una imagen de la carpeta del
/// juego vinculada. La ruta es relativa a la raiz recordada, nunca absoluta.
#[tauri::command]
pub async fn read_game_file(
    state: State<'_, AppState>,
    rel: String,
) -> Result<Response, DriverErrorDto> {
    let root = state
        .game_root
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| err("NoGameFolder", "no hay una carpeta de juego vinculada"))?;
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        let full = resolve_game_file(&root, &rel)?;
        fs::read(full).map_err(|e| err("Io", e.to_string()))
    })
    .await
    .map_err(|e| err("Internal", e.to_string()))??;
    Ok(Response::new(bytes))
}

#[tauri::command]
pub fn assetmap_load(app: AppHandle, root: String) -> Result<Option<Value>, DriverErrorDto> {
    read_assetmap(&assetmap_path(&data_dir(&app)?, &root))
}

#[tauri::command]
pub fn assetmap_save(app: AppHandle, root: String, map: Value) -> Result<(), DriverErrorDto> {
    write_assetmap(&assetmap_path(&data_dir(&app)?, &root), &map)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// PNG minimo valido solo en cabecera (basta para `png_size`).
    fn png_header(w: u32, h: u32) -> Vec<u8> {
        let mut v = b"\x89PNG\r\n\x1a\n".to_vec();
        v.extend_from_slice(&13u32.to_be_bytes());
        v.extend_from_slice(b"IHDR");
        v.extend_from_slice(&w.to_be_bytes());
        v.extend_from_slice(&h.to_be_bytes());
        v.extend_from_slice(&[8, 6, 0, 0, 0]);
        v
    }

    struct Tmp(PathBuf);
    impl Tmp {
        fn new(tag: &str) -> Self {
            let p = std::env::temp_dir().join(format!(
                "peshex_game_{}_{}_{}",
                tag,
                std::process::id(),
                fnv1a64(&format!("{:?}", std::time::SystemTime::now()))
            ));
            fs::create_dir_all(&p).unwrap();
            Tmp(p)
        }
        fn write(&self, rel: &str, bytes: &[u8]) {
            let p = self.0.join(rel);
            fs::create_dir_all(p.parent().unwrap()).unwrap();
            fs::write(p, bytes).unwrap();
        }
    }
    impl Drop for Tmp {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn sample_game() -> Tmp {
        let t = Tmp::new("scan");
        t.write("Game.ini", b"[Game]\r\nTitle=Test\r\n");
        t.write("Graphics/Pokemon/Icons/BULBASAUR.png", &png_header(128, 64));
        t.write("Graphics/Pokemon/Icons shiny/BULBASAUR.png", &png_header(128, 64));
        t.write("Graphics/Items/POTION.png", &png_header(48, 48));
        t.write("Graphics/UI/Storage/box_0.png", &png_header(324, 296));
        t.write("Graphics/Characters/hero.png", &png_header(32, 32)); // no relevante
        t.write("Graphics/Pokemon/readme.txt", b"no es imagen");
        t
    }

    #[test]
    fn png_size_lee_la_cabecera() {
        let t = Tmp::new("png");
        t.write("a.png", &png_header(128, 64));
        t.write("b.png", b"no soy png");
        assert_eq!(png_size(&t.0.join("a.png")), Some((128, 64)));
        assert_eq!(png_size(&t.0.join("b.png")), None);
        assert_eq!(png_size(&t.0.join("falta.png")), None);
    }

    #[test]
    fn el_escaneo_indexa_solo_imagenes_relevantes_con_sus_medidas() {
        let g = sample_game();
        let scan = scan_graphics(&g.0, MAX_FILES).unwrap();
        let paths: Vec<_> = scan.files.iter().map(|f| f.0.as_str()).collect();
        assert_eq!(
            paths,
            vec![
                "Graphics/Items/POTION.png",
                "Graphics/Pokemon/Icons shiny/BULBASAUR.png",
                "Graphics/Pokemon/Icons/BULBASAUR.png",
                "Graphics/UI/Storage/box_0.png"
            ]
        );
        let icon = scan.files.iter().find(|f| f.0.ends_with("Icons/BULBASAUR.png")).unwrap();
        assert_eq!((icon.1, icon.2), (128, 64));
        assert!(!scan.truncated);
        assert!(scan.graphics.is_some());
    }

    #[test]
    fn el_escaneo_respeta_el_tope_y_avisa() {
        let g = sample_game();
        let scan = scan_graphics(&g.0, 2).unwrap();
        assert_eq!(scan.files.len(), 2);
        assert!(scan.truncated);
    }

    #[test]
    fn graphics_se_encuentra_sin_distinguir_mayusculas() {
        let t = Tmp::new("ci");
        t.write("graphics/pokemon/icons/A.png", &png_header(64, 64));
        let scan = scan_graphics(&t.0, MAX_FILES).unwrap();
        assert_eq!(scan.files.len(), 1);
    }

    #[test]
    fn una_carpeta_sin_graphics_da_lista_vacia_y_una_inexistente_error() {
        let t = Tmp::new("empty");
        assert!(scan_graphics(&t.0, MAX_FILES).unwrap().files.is_empty());
        assert!(scan_graphics(&t.0.join("nope"), MAX_FILES).is_err());
    }

    #[test]
    fn leer_un_archivo_valido_funciona() {
        let g = sample_game();
        let p = resolve_game_file(&g.0, "Graphics/Items/POTION.png").unwrap();
        assert!(p.is_file());
    }

    #[test]
    fn se_rechazan_rutas_peligrosas() {
        let g = sample_game();
        for bad in [
            "../secreto.png",
            "Graphics/../../secreto.png",
            "/etc/passwd.png",
            "Graphics/Pokemon/readme.txt",
            "",
            "Game.ini",
            "Graphics\0/a.png",
        ] {
            assert!(resolve_game_file(&g.0, bad).is_err(), "debia rechazar {bad:?}");
        }
    }

    #[cfg(unix)]
    #[test]
    fn un_symlink_que_sale_de_la_carpeta_se_rechaza() {
        let g = sample_game();
        let outside = Tmp::new("outside");
        outside.write("secreto.png", &png_header(1, 1));
        std::os::unix::fs::symlink(outside.0.join("secreto.png"), g.0.join("Graphics/Items/link.png")).unwrap();
        assert!(resolve_game_file(&g.0, "Graphics/Items/link.png").is_err());
        // y el escaneo ni siquiera lo lista
        let scan = scan_graphics(&g.0, MAX_FILES).unwrap();
        assert!(!scan.files.iter().any(|f| f.0.ends_with("link.png")));
    }

    #[test]
    fn el_hash_de_ruta_es_estable_y_normaliza_separadores() {
        assert_eq!(fnv1a64("abc"), 0xe71f_a219_0541_574b);
        let base = Path::new("/datos");
        assert_eq!(
            assetmap_path(base, "C:\\Juegos\\Mi Juego\\"),
            assetmap_path(base, "c:/juegos/mi juego")
        );
        assert_ne!(assetmap_path(base, "/a"), assetmap_path(base, "/b"));
    }

    #[test]
    fn el_mapa_manual_se_guarda_y_se_lee() {
        let t = Tmp::new("map");
        let p = assetmap_path(&t.0, "/juego");
        assert_eq!(read_assetmap(&p).unwrap(), None);
        let map = serde_json::json!({ "version": 1, "pokemon": { "icon": { "FAKEMON": "Graphics/Pokemon/Icons/X.png" } } });
        write_assetmap(&p, &map).unwrap();
        assert_eq!(read_assetmap(&p).unwrap(), Some(map));
        fs::write(&p, "{ no es json").unwrap();
        assert!(read_assetmap(&p).is_err());
    }
}
