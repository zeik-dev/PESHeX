//! Carpeta del juego vinculada: escaneo de `Graphics/`, lectura segura de
//! imagenes y mapa manual de assets (`assetmap.json`).
//!
//! PESHeX solo LEE la carpeta del juego del usuario: nunca escribe en ella. El
//! mapa manual se guarda en el directorio de datos de la app, una vez por
//! juego (identificado por un hash de su ruta).

use std::collections::HashMap;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::time::UNIX_EPOCH;

use peshex_core::fsutil::{read_json, write_json};
use peshex_core::registry::game_id;
use rxdriver::DriverErrorDto;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::ipc::Response;
use tauri::{AppHandle, Manager, State};

use crate::state::AppState;

/// Subcarpetas de `Graphics/` que contienen lo que PESHeX dibuja (el resto:
/// tilesets, charsets, fondos... no hace falta indexarlo).
const RELEVANT_DIRS: &[&str] = &[
    "pokemon", "items", "ui", "pictures", "icons", "battlers", "trainers",
];
/// Subcarpetas de `Graphics/` de las que solo se indexan los archivos cuyo nombre empieza por alguno de estos prefijos:
/// `Characters` guarda miles de sprites de mapa y de ahi solo interesa la imagen del entrenador (en las bases <= v18:
/// `trainer004.png`, y `trchar004.png` de su sprite de mapa).
const FILTERED_DIRS: &[(&str, &[&str])] = &[("characters", &["trainer", "trchar"])];
const IMAGE_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "gif", "bmp"];
const MAX_FILES: usize = 50_000;
const MAX_DEPTH: usize = 8;
const MAX_IMAGE_BYTES: u64 = 8 * 1024 * 1024;

/// Version del formato del indice en cache (si cambia, el indice anterior se descarta).
const GRAPHICS_CACHE_VERSION: u32 = 1;

/// Lo ultimo que se supo de una imagen: con el mismo tamano y la misma fecha de modificacion no hace falta volver a abrirla
/// para leer sus medidas (abrir miles de archivos es lo que tarda, sobre todo con un antivirus mirando cada apertura).
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
struct CachedFile {
    size: u64,
    mtime: u64,
    w: u32,
    h: u32,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct GraphicsCache {
    #[serde(default)]
    version: u32,
    #[serde(default)]
    files: HashMap<String, CachedFile>,
}

/// Cuanto trabajo hizo un escaneo: `reused` imagenes cuyas medidas salieron de la cache y `read` cuyas cabeceras hubo que abrir.
#[derive(Debug, Default, Clone, Copy, PartialEq)]
pub struct ScanStats {
    pub reused: usize,
    pub read: usize,
}

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

/// ¿El nombre del archivo empieza por alguno de los prefijos (sin distinguir mayusculas)? Sin prefijos, siempre.
fn name_matches(path: &Path, prefixes: Option<&[&str]>) -> bool {
    let Some(prefixes) = prefixes else { return true };
    let name = path.file_name().map(|n| n.to_string_lossy().to_ascii_lowercase()).unwrap_or_default();
    prefixes.iter().any(|p| name.starts_with(p))
}

/// Estado de un recorrido de `Graphics/`: lo que ya se sabia (cache), lo nuevo y cuanto trabajo costo.
struct Walker<'a> {
    base: &'a Path,
    cap: usize,
    old: &'a HashMap<String, CachedFile>,
    fresh: HashMap<String, CachedFile>,
    stats: ScanStats,
    out: Vec<(String, u32, u32)>,
}

impl Walker<'_> {
    fn walk(&mut self, dir: &Path, depth: usize, prefixes: Option<&[&str]>) -> bool {
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
                if self.walk(&path, depth + 1, prefixes) {
                    return true;
                }
            } else if ft.is_file() && is_image(&path) && name_matches(&path, prefixes) {
                if self.out.len() >= self.cap {
                    return true;
                }
                let rel = path
                    .strip_prefix(self.base)
                    .map(|p| {
                        p.components()
                            .map(|c| c.as_os_str().to_string_lossy().into_owned())
                            .collect::<Vec<_>>()
                            .join("/")
                    })
                    .unwrap_or_default();
                let (w, h) = self.measure(&e, &path, &rel);
                self.out.push((rel, w, h));
            }
        }
        false
    }

    /// Medidas de una imagen: de la cache si el archivo no cambio (mismo tamano y fecha); si no, de su cabecera PNG.
    fn measure(&mut self, entry: &fs::DirEntry, path: &Path, rel: &str) -> (u32, u32) {
        let stamp = entry.metadata().ok().map(|m| {
            let mtime = m.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0);
            (m.len(), mtime)
        });
        if let Some((size, mtime)) = stamp {
            if let Some(c) = self.old.get(rel).filter(|c| c.size == size && c.mtime == mtime) {
                self.stats.reused += 1;
                self.fresh.insert(rel.to_string(), *c);
                return (c.w, c.h);
            }
        }
        self.stats.read += 1;
        let (w, h) = png_size(path).unwrap_or((0, 0));
        if let Some((size, mtime)) = stamp {
            self.fresh.insert(rel.to_string(), CachedFile { size, mtime, w, h });
        }
        (w, h)
    }
}

/// Recorre las carpetas relevantes de `Graphics/` de la raiz del juego.
pub fn scan_graphics(root: &Path, cap: usize) -> Result<GameScan, DriverErrorDto> {
    scan_graphics_cached(root, cap, None).map(|(scan, _)| scan)
}

/// Igual que [`scan_graphics`], pero con un indice en cache (`cache_file`): solo se abren las imagenes nuevas o modificadas
/// desde el ultimo escaneo y el resto reutiliza sus medidas. El indice se actualiza (de forma atomica) si algo cambio.
pub fn scan_graphics_cached(
    root: &Path,
    cap: usize,
    cache_file: Option<&Path>,
) -> Result<(GameScan, ScanStats), DriverErrorDto> {
    if !root.is_dir() {
        return Err(err(
            "GameFolderInvalid",
            format!("no existe la carpeta '{}'", root.display()),
        ));
    }
    let graphics = child_ci(root, "Graphics").filter(|g| g.is_dir());
    let old: GraphicsCache = cache_file
        .and_then(read_json::<GraphicsCache>)
        .filter(|c| c.version == GRAPHICS_CACHE_VERSION)
        .unwrap_or_default();
    let mut walker = Walker { base: root, cap, old: &old.files, fresh: HashMap::new(), stats: ScanStats::default(), out: Vec::new() };
    let mut truncated = false;
    if let Some(g) = &graphics {
        let dirs = RELEVANT_DIRS.iter().map(|n| (*n, None)).chain(FILTERED_DIRS.iter().map(|(n, p)| (*n, Some(*p))));
        for (name, prefixes) in dirs {
            if let Some(sub) = child_ci(g, name).filter(|p| p.is_dir()) {
                if walker.walk(&sub, 0, prefixes) {
                    truncated = true;
                    break;
                }
            }
        }
    }
    let Walker { fresh, stats, out: mut files, .. } = walker;
    // Se guarda lo nuevo solo si no se corto por el tope (un indice parcial no sirve) y si algo cambio.
    if let Some(path) = cache_file {
        if !truncated && fresh != old.files {
            let _ = write_json(path, &GraphicsCache { version: GRAPHICS_CACHE_VERSION, files: fresh });
        }
    }
    files.sort_by(|a, b| a.0.cmp(&b.0));
    Ok((
        GameScan {
            root: root.to_string_lossy().into_owned(),
            graphics: graphics.map(|g| g.to_string_lossy().into_owned()),
            files,
            truncated,
        },
        stats,
    ))
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

/// Carpeta de cache de un juego: `<datos de la app>/gamecache/<id del juego>/`. El indice de imagenes y la cache de datos del
/// driver Ruby viven ahi.
pub fn game_cache_dir(data_dir: &Path, root: &Path) -> PathBuf {
    data_dir.join("gamecache").join(game_id(root))
}

fn graphics_cache_path(data_dir: &Path, root: &Path) -> PathBuf {
    game_cache_dir(data_dir, root).join("graphics.json")
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
    let cache = graphics_cache_path(&data_dir(&app)?, &root_path);
    let scan = tauri::async_runtime::spawn_blocking(move || scan_graphics_cached(&root_path, MAX_FILES, Some(&cache)))
        .await
        .map_err(|e| err("Internal", e.to_string()))??
        .0;
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
        t.write("Graphics/Characters/trainer004.png", &png_header(180, 180)); // imagen del entrenador (v16-18)
        t.write("Graphics/Characters/TRCHAR004.PNG", &png_header(256, 272)); // sprite de mapa del jugador
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
                "Graphics/Characters/TRCHAR004.PNG",
                "Graphics/Characters/trainer004.png",
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
    fn con_cache_solo_se_abren_las_imagenes_nuevas_o_modificadas() {
        let g = sample_game();
        let cache = g.0.join("cache").join("graphics.json");
        let (first, s1) = scan_graphics_cached(&g.0, MAX_FILES, Some(&cache)).unwrap();
        assert_eq!((s1.reused, s1.read), (0, 6), "la primera vez se abre todo");
        assert!(cache.is_file());

        let (second, s2) = scan_graphics_cached(&g.0, MAX_FILES, Some(&cache)).unwrap();
        assert_eq!((s2.reused, s2.read), (6, 0), "la segunda no abre ningun archivo");
        assert_eq!(first, second, "y el resultado es el mismo");

        // Una imagen nueva y otra modificada (otro tamano): solo esas dos se vuelven a abrir.
        g.write("Graphics/Items/ETHER.png", &png_header(48, 48));
        g.write("Graphics/Items/POTION.png", &png_header(64, 64));
        // `png_header` mide siempre lo mismo y la fecha tiene resolucion de segundos: se adelanta la de la modificada.
        let later = std::time::SystemTime::now() + std::time::Duration::from_secs(30);
        fs::File::options().write(true).open(g.0.join("Graphics/Items/POTION.png")).unwrap().set_modified(later).unwrap();
        let (third, s3) = scan_graphics_cached(&g.0, MAX_FILES, Some(&cache)).unwrap();
        assert_eq!((s3.reused, s3.read), (5, 2), "6 conocidas + 1 nueva: se abren la nueva y la modificada");
        let potion = third.files.iter().find(|f| f.0.ends_with("POTION.png")).unwrap();
        assert_eq!((potion.1, potion.2), (64, 64), "se vieron las medidas nuevas");

        // Un archivo borrado desaparece del indice y no queda basura en la cache.
        fs::remove_file(g.0.join("Graphics/Items/ETHER.png")).unwrap();
        let (fourth, _) = scan_graphics_cached(&g.0, MAX_FILES, Some(&cache)).unwrap();
        assert!(!fourth.files.iter().any(|f| f.0.ends_with("ETHER.png")));
        let saved: GraphicsCache = read_json(&cache).unwrap();
        assert!(!saved.files.contains_key("Graphics/Items/ETHER.png"));
    }

    #[test]
    fn una_cache_danada_o_de_otra_version_se_ignora() {
        let g = sample_game();
        let cache = g.0.join("graphics.json");
        fs::write(&cache, b"{ roto").unwrap();
        let (_, s) = scan_graphics_cached(&g.0, MAX_FILES, Some(&cache)).unwrap();
        assert_eq!((s.reused, s.read), (0, 6));
        fs::write(&cache, br#"{"version":99,"files":{"Graphics/Items/POTION.png":{"size":1,"mtime":1,"w":9,"h":9}}}"#).unwrap();
        let (scan, s) = scan_graphics_cached(&g.0, MAX_FILES, Some(&cache)).unwrap();
        assert_eq!(s.reused, 0);
        let potion = scan.files.iter().find(|f| f.0.ends_with("POTION.png")).unwrap();
        assert_eq!((potion.1, potion.2), (48, 48));
    }

    #[test]
    fn un_escaneo_cortado_por_el_tope_no_guarda_un_indice_parcial() {
        let g = sample_game();
        let cache = g.0.join("graphics.json");
        let (scan, _) = scan_graphics_cached(&g.0, 2, Some(&cache)).unwrap();
        assert!(scan.truncated);
        assert!(!cache.exists());
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
