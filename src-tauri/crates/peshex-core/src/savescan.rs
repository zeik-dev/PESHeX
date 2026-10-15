//! Save Scan: encuentra donde guarda las partidas un juego de Essentials y lista sus archivos (sin copias de seguridad).
//!
//! Donde vive el save depende de la base: las v19+ lo guardan en `%APPDATA%\<NombreDelJuego>\Game.rxdata`; las antiguas y los juegos
//! portables, junto al juego o en una carpeta `Saves`. No hay una regla unica, asi que se prueban carpetas candidatas por orden
//! de fiabilidad y se queda con la primera que tenga partidas de verdad. Si ninguna sirve, el usuario elige la carpeta a mano.
//!
//! Solo LEE: nunca escribe ni borra nada del juego ni de las carpetas de guardado.

use std::collections::HashSet;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::{Deserialize, Serialize};

/// Carpetas del juego que nunca contienen partidas (y de las que no se baja): datos y recursos del propio juego.
const SKIP_DIRS: &[&str] = &["data", "graphics", "audio", "pbs", "fonts", "movies", "plugins", "mkxp", "ruby", "system"];
/// Nombres de subcarpeta que suelen guardar partidas.
const SAVE_DIR_HINTS: &[&str] = &["save", "partida", "guardad", "slot", "savedata", "saves"];
/// Un save de Essentials es un Marshal de Ruby (cabecera 4.8) y no cabe en menos de esto.
const MIN_SAVE_BYTES: u64 = 64;
const MAX_SUBDIR_DEPTH: usize = 2;

/// De donde sale una carpeta candidata (de mas a menos fiable).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Source {
    /// La eligio el usuario.
    Manual,
    /// `%APPDATA%\<titulo del juego>` o equivalente: lo normal en Essentials v19+.
    AppData,
    /// Una subcarpeta del juego con nombre de guardado (`Saves`, `Partidas`...).
    GameSubdir,
    /// La propia carpeta del juego.
    GameRoot,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveFile {
    pub name: String,
    pub path: String,
    pub size: u64,
    /// Ultima modificacion, en segundos desde 1970.
    pub modified: Option<u64>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    pub dir: String,
    pub source: Source,
    /// Cuantas partidas hay en ella.
    pub count: usize,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    /// La carpeta elegida (la primera candidata con partidas), si hay alguna.
    pub dir: Option<String>,
    pub source: Option<Source>,
    /// Las partidas de `dir`, la mas reciente primero.
    pub files: Vec<SaveFile>,
    /// Todas las carpetas que se miraron, con cuantas partidas tenia cada una (para explicar el resultado a la persona).
    pub candidates: Vec<Candidate>,
}

pub struct ScanInput<'a> {
    pub root: &'a Path,
    /// `Title=` de `Game.ini` (la carpeta de `%APPDATA%` suele llamarse asi).
    pub title: Option<&'a str>,
    /// Carpetas donde buscar `<nombre del juego>`: `%APPDATA%`, `%LOCALAPPDATA%`, `Saved Games`, Documentos...
    pub data_dirs: &'a [PathBuf],
    /// Carpetas de guardado elegidas por el usuario para este juego (van primero).
    pub manual: &'a [PathBuf],
}

/// `Title=` de `Game.ini` (insensible a mayusculas y a la codificacion rara de algunos editores).
pub fn game_title(root: &Path) -> Option<String> {
    let ini = child_ci(root, "Game.ini")?;
    let bytes = fs::read(ini).ok()?;
    let text = String::from_utf8_lossy(&bytes);
    text.lines().find_map(|l| {
        let l = l.trim().trim_start_matches('\u{feff}');
        let (k, v) = l.split_once('=')?;
        (k.trim().eq_ignore_ascii_case("title") && !v.trim().is_empty()).then(|| v.trim().to_string())
    })
}

fn child_ci(dir: &Path, name: &str) -> Option<PathBuf> {
    let exact = dir.join(name);
    if exact.exists() {
        return Some(exact);
    }
    fs::read_dir(dir).ok()?.flatten().find_map(|e| e.file_name().to_string_lossy().eq_ignore_ascii_case(name).then(|| e.path()))
}

/// Quita lo que Windows no admite en un nombre de carpeta (`: * ? " < > |`) para probar el titulo tal como lo crearia el juego.
fn sanitize(name: &str) -> String {
    name.chars().filter(|c| !matches!(c, '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|')).collect::<String>().trim().to_string()
}

fn key(p: &Path) -> String {
    p.to_string_lossy().replace('\\', "/").trim_end_matches('/').to_lowercase()
}

/// ¿Es `path` una partida? `*.rxdata` (sin distinguir mayusculas; los `.bak` y los temporales tienen otra extension), con la
/// cabecera de Marshal de Ruby (`04 08`) y un tamano razonable.
pub fn is_save_file(path: &Path) -> bool {
    let name = path.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
    if !name.ends_with(".rxdata") || name.contains(".bak") {
        return false;
    }
    let Ok(meta) = fs::metadata(path) else { return false };
    if !meta.is_file() || meta.len() < MIN_SAVE_BYTES {
        return false;
    }
    let mut head = [0u8; 2];
    fs::File::open(path).and_then(|mut f| f.read_exact(&mut head)).is_ok() && head == [0x04, 0x08]
}

/// Las partidas de una carpeta (sin bajar a subcarpetas), la mas reciente primero. Ignora copias de seguridad y temporales.
pub fn list_saves(dir: &Path) -> Vec<SaveFile> {
    let Ok(rd) = fs::read_dir(dir) else { return Vec::new() };
    let mut out: Vec<SaveFile> = rd
        .flatten()
        .filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false))
        .map(|e| e.path())
        .filter(|p| is_save_file(p))
        .filter_map(|p| {
            let meta = fs::metadata(&p).ok()?;
            let modified = meta.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_secs());
            Some(SaveFile { name: p.file_name()?.to_string_lossy().into_owned(), path: p.to_string_lossy().into_owned(), size: meta.len(), modified })
        })
        .collect();
    out.sort_by(|a, b| b.modified.cmp(&a.modified).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    out
}

/// Subcarpetas del juego con nombre de guardado, hasta `MAX_SUBDIR_DEPTH` niveles, sin entrar en las carpetas del propio juego.
fn game_subdirs(root: &Path) -> Vec<PathBuf> {
    fn walk(dir: &Path, depth: usize, out: &mut Vec<PathBuf>) {
        let Ok(rd) = fs::read_dir(dir) else { return };
        let mut dirs: Vec<PathBuf> = rd.flatten().filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false)).map(|e| e.path()).collect();
        dirs.sort();
        for d in dirs {
            let name = d.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
            if SKIP_DIRS.contains(&name.as_str()) {
                continue;
            }
            if SAVE_DIR_HINTS.iter().any(|h| name.contains(h)) {
                out.push(d.clone());
            }
            if depth < MAX_SUBDIR_DEPTH {
                walk(&d, depth + 1, out);
            }
        }
    }
    let mut out = Vec::new();
    walk(root, 1, &mut out);
    out
}

/// Las carpetas candidatas, de mas a menos fiable y sin repetir.
pub fn candidate_dirs(input: &ScanInput) -> Vec<(PathBuf, Source)> {
    let mut out: Vec<(PathBuf, Source)> = Vec::new();
    let mut seen = HashSet::new();
    let mut push = |p: PathBuf, s: Source| {
        if seen.insert(key(&p)) {
            out.push((p, s));
        }
    };
    for m in input.manual {
        push(m.clone(), Source::Manual);
    }

    // %APPDATA%\<nombre>: el titulo del juego (tal cual y sin caracteres prohibidos) y el nombre de la carpeta del juego.
    let folder = input.root.file_name().map(|n| n.to_string_lossy().into_owned());
    let mut names: Vec<String> = Vec::new();
    for n in input.title.map(str::to_string).into_iter().chain(input.title.map(sanitize)).chain(folder.clone()) {
        if !n.is_empty() && !names.iter().any(|x| x.eq_ignore_ascii_case(&n)) {
            names.push(n);
        }
    }
    for base in input.data_dirs {
        for n in &names {
            push(base.join(n), Source::AppData);
        }
    }
    for d in game_subdirs(input.root) {
        push(d, Source::GameSubdir);
    }
    push(input.root.to_path_buf(), Source::GameRoot);
    out
}

/// Analiza el juego y devuelve la carpeta de partidas mas probable, sus archivos y lo que se probo.
pub fn scan_saves(input: &ScanInput) -> ScanResult {
    let mut result = ScanResult { dir: None, source: None, files: Vec::new(), candidates: Vec::new() };
    for (dir, source) in candidate_dirs(input) {
        if !dir.is_dir() {
            continue;
        }
        let files = list_saves(&dir);
        result.candidates.push(Candidate { dir: dir.to_string_lossy().into_owned(), source, count: files.len() });
        if result.dir.is_none() && !files.is_empty() {
            result.dir = Some(dir.to_string_lossy().into_owned());
            result.source = Some(source);
            result.files = files;
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::Tmp;
    use std::time::{Duration, SystemTime};

    /// Un "save" valido: cabecera de Marshal de Ruby 4.8 y relleno.
    fn save_bytes() -> Vec<u8> {
        let mut v = vec![0x04, 0x08, b'[', 0x07];
        v.extend(std::iter::repeat(0u8).take(100));
        v
    }

    fn touch_old(path: &Path, secs_ago: u64) {
        let t = SystemTime::now() - Duration::from_secs(secs_ago);
        fs::File::options().write(true).open(path).unwrap().set_modified(t).unwrap();
    }

    fn game(t: &Tmp) -> PathBuf {
        t.write("Mi Juego/Game.ini", b"[Game]\r\nTitle=Pokemon: Mi Aventura\r\nScripts=Data\\Scripts.rxdata\r\n");
        t.write("Mi Juego/Data/Actors.rxdata", &save_bytes()); // datos del juego: NO es una partida
        t.write("Mi Juego/Graphics/x.png", b"png");
        t.path().join("Mi Juego")
    }

    #[test]
    fn lee_el_titulo_de_game_ini() {
        let t = Tmp::new("title");
        let root = game(&t);
        assert_eq!(game_title(&root).as_deref(), Some("Pokemon: Mi Aventura"));
        assert_eq!(game_title(&t.path().join("nada")), None);
        t.write("sin/Game.ini", b"[Game]\r\nRTP1=Standard\r\n");
        assert_eq!(game_title(&t.path().join("sin")), None);
    }

    #[test]
    fn una_partida_necesita_extension_rxdata_cabecera_de_marshal_y_tamano() {
        let t = Tmp::new("isave");
        let ok = t.write("Game.rxdata", &save_bytes());
        assert!(is_save_file(&ok));
        assert!(is_save_file(&t.write("OTRA.RXDATA", &save_bytes())), "sin distinguir mayusculas");
        assert!(!is_save_file(&t.write("Game.rxdata.20261015-120000.bak", &save_bytes())), "copia de seguridad");
        assert!(!is_save_file(&t.write("Game.rxdata.20261015-120000-prerestore.bak", &save_bytes())));
        assert!(!is_save_file(&t.write("Game.rxdata.tmp-123", &save_bytes())), "temporal de PESHeX");
        assert!(!is_save_file(&t.write("texto.rxdata", &vec![b'x'; 200])), "no es un Marshal");
        assert!(!is_save_file(&t.write("vacio.rxdata", &[0x04, 0x08])), "demasiado pequeno");
        assert!(!is_save_file(&t.write("notas.txt", &save_bytes())));
        assert!(!is_save_file(&t.path().join("falta.rxdata")));
    }

    #[test]
    fn lista_varias_partidas_de_la_misma_carpeta_ignorando_copias_y_ordena_por_fecha() {
        let t = Tmp::new("list");
        let a = t.write("Saves/Game.rxdata", &save_bytes());
        let b = t.write("Saves/Game2.rxdata", &save_bytes());
        t.write("Saves/Game.rxdata.20261015-120000.bak", &save_bytes());
        t.write("Saves/Game2.rxdata.20261015-120001.bak", &save_bytes());
        t.write("Saves/Game2.rxdata.tmp-9", &save_bytes());
        t.write("Saves/leeme.txt", b"hola");
        touch_old(&a, 3600);
        touch_old(&b, 60);
        let files = list_saves(&t.path().join("Saves"));
        let names: Vec<_> = files.iter().map(|f| f.name.as_str()).collect();
        assert_eq!(names, vec!["Game2.rxdata", "Game.rxdata"], "la mas reciente primero, sin .bak ni temporales");
        assert!(files[0].size >= MIN_SAVE_BYTES && files[0].modified.is_some());
    }

    #[test]
    fn essentials_v19_busca_en_appdata_por_el_titulo_del_juego() {
        let t = Tmp::new("appdata");
        let root = game(&t);
        t.write("Roaming/Pokemon Mi Aventura/Game.rxdata", &save_bytes()); // titulo sin los dos puntos
        let data = [t.path().join("Roaming")];
        let r = scan_saves(&ScanInput { root: &root, title: Some("Pokemon: Mi Aventura"), data_dirs: &data, manual: &[] });
        assert_eq!(r.source, Some(Source::AppData));
        assert!(r.dir.as_deref().unwrap().ends_with("Pokemon Mi Aventura"));
        assert_eq!(r.files.len(), 1);
        assert!(r.candidates.iter().any(|c| c.source == Source::GameRoot), "tambien se miro la carpeta del juego");
    }

    #[test]
    fn tambien_prueba_el_nombre_de_la_carpeta_del_juego() {
        let t = Tmp::new("folder");
        let root = game(&t);
        t.write("Roaming/Mi Juego/Game.rxdata", &save_bytes());
        let data = [t.path().join("Roaming")];
        let r = scan_saves(&ScanInput { root: &root, title: None, data_dirs: &data, manual: &[] });
        assert!(r.dir.as_deref().unwrap().ends_with("Mi Juego"));
    }

    #[test]
    fn juego_portable_guarda_en_una_subcarpeta_o_junto_al_juego() {
        let t = Tmp::new("portable");
        let root = game(&t);
        t.write("Mi Juego/Saves/Partida1.rxdata", &save_bytes());
        let r = scan_saves(&ScanInput { root: &root, title: None, data_dirs: &[], manual: &[] });
        assert_eq!(r.source, Some(Source::GameSubdir));
        assert_eq!(r.files[0].name, "Partida1.rxdata");

        let t2 = Tmp::new("portable2");
        let root2 = game(&t2);
        t2.write("Mi Juego/Game.rxdata", &save_bytes());
        let r2 = scan_saves(&ScanInput { root: &root2, title: None, data_dirs: &[], manual: &[] });
        assert_eq!(r2.source, Some(Source::GameRoot));
        assert_eq!(r2.files.len(), 1, "los .rxdata de Data/ no cuentan: son datos del juego");
        assert_eq!(r2.files[0].name, "Game.rxdata");
    }

    #[test]
    fn la_carpeta_elegida_a_mano_gana_a_todas() {
        let t = Tmp::new("manual");
        let root = game(&t);
        t.write("Roaming/Mi Juego/Game.rxdata", &save_bytes());
        t.write("Elegida/Mia.rxdata", &save_bytes());
        let data = [t.path().join("Roaming")];
        let manual = [t.path().join("Elegida")];
        let r = scan_saves(&ScanInput { root: &root, title: None, data_dirs: &data, manual: &manual });
        assert_eq!(r.source, Some(Source::Manual));
        assert_eq!(r.files[0].name, "Mia.rxdata");
        assert!(r.candidates.len() >= 2, "se sigue informando de las demas");
    }

    #[test]
    fn si_no_hay_partidas_en_ningun_sitio_no_inventa_una_carpeta() {
        let t = Tmp::new("none");
        let root = game(&t);
        let data = [t.path().join("Roaming")];
        let r = scan_saves(&ScanInput { root: &root, title: Some("X"), data_dirs: &data, manual: &[] });
        assert!(r.dir.is_none() && r.files.is_empty());
        assert!(r.candidates.iter().all(|c| c.count == 0));
    }

    #[test]
    fn rutas_con_espacios_y_enie_y_candidatas_repetidas() {
        let t = Tmp::new("ñandú");
        t.write("Juegos ñ/El Añil/Game.ini", "[Game]\r\nTitle=El Añil\r\n".as_bytes());
        t.write("Datos/El Añil/Game.rxdata", &save_bytes());
        let root = t.path().join("Juegos ñ").join("El Añil");
        let data = [t.path().join("Datos"), t.path().join("Datos")];
        let r = scan_saves(&ScanInput { root: &root, title: Some("El Añil"), data_dirs: &data, manual: &[] });
        assert_eq!(r.files.len(), 1);
        let dirs: Vec<_> = r.candidates.iter().map(|c| c.dir.to_lowercase()).collect();
        let unique: HashSet<_> = dirs.iter().collect();
        assert_eq!(dirs.len(), unique.len(), "no se repite ninguna carpeta: {dirs:?}");
    }

    #[test]
    fn las_carpetas_del_propio_juego_no_se_recorren() {
        let t = Tmp::new("skip");
        let root = game(&t);
        // una carpeta "Saves" DENTRO de Data/ o Graphics/ no es una carpeta de partidas
        t.write("Mi Juego/Data/Saves/Falsa.rxdata", &save_bytes());
        t.write("Mi Juego/Graphics/Saves/Falsa2.rxdata", &save_bytes());
        let r = scan_saves(&ScanInput { root: &root, title: None, data_dirs: &[], manual: &[] });
        assert!(r.files.is_empty(), "{:?}", r.candidates);
    }
}
