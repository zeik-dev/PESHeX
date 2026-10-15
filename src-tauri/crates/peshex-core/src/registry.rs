//! Biblioteca de juegos («Mis juegos»): los fangames que la persona registra en PESHeX, con su carpeta de partidas (la que
//! encuentra el Save Scan o la que elige a mano) y lo necesario para cargarlos mas rapido. Se guarda en `games.json` dentro de
//! la carpeta de datos de la app, con escritura atomica; un archivo danado se ignora (nunca impide arrancar).

use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::fsutil::{fnv1a64, read_json, write_json};
use crate::savescan::{ScanResult, Source};

pub const REGISTRY_VERSION: u32 = 1;

/// Resultado del ultimo Save Scan de un juego.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LastScan {
    pub dir: Option<String>,
    pub source: Option<Source>,
    pub count: usize,
    pub at: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameEntry {
    /// Hash estable (hex) de la ruta de la carpeta del juego.
    pub id: String,
    pub root: String,
    /// Nombre que se muestra (por defecto el titulo de `Game.ini` o el de la carpeta); se puede renombrar.
    pub name: String,
    /// `Title=` de `Game.ini`.
    pub title: Option<String>,
    pub added_at: u64,
    pub last_opened_at: Option<u64>,
    /// Carpetas de partidas elegidas a mano (cuando el Save Scan no encuentra las suyas).
    #[serde(default)]
    pub save_dirs: Vec<String>,
    #[serde(default)]
    pub last_scan: Option<LastScan>,
    /// Cuando se precargaron (indexaron) sus datos y con que huella (la calcula el driver Ruby).
    #[serde(default)]
    pub indexed_at: Option<u64>,
    #[serde(default)]
    pub fingerprint: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Registry {
    #[serde(default = "default_version")]
    pub version: u32,
    #[serde(default)]
    pub games: Vec<GameEntry>,
}

fn default_version() -> u32 {
    REGISTRY_VERSION
}

impl Default for Registry {
    fn default() -> Self {
        Registry { version: REGISTRY_VERSION, games: Vec::new() }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum RegistryError {
    /// La carpeta no parece la de un juego de Essentials.
    NotAGameFolder(String),
    NotFound(String),
}

/// Ruta normalizada para comparar (separadores, mayusculas y barra final: en Windows las rutas no distinguen mayusculas).
pub fn norm(p: &str) -> String {
    p.replace('\\', "/").trim_end_matches('/').to_lowercase()
}

/// Identificador estable de un juego: hash de su ruta normalizada.
pub fn game_id(root: &Path) -> String {
    format!("{:016x}", fnv1a64(&norm(&root.to_string_lossy())))
}

fn child_ci(dir: &Path, name: &str) -> Option<std::path::PathBuf> {
    let exact = dir.join(name);
    if exact.exists() {
        return Some(exact);
    }
    fs::read_dir(dir).ok()?.flatten().find_map(|e| e.file_name().to_string_lossy().eq_ignore_ascii_case(name).then(|| e.path()))
}

/// ¿Parece la carpeta de un juego de Essentials? `Game.ini`, `Data/Scripts.rxdata` o las carpetas `Data` y `Graphics`.
pub fn looks_like_game_root(dir: &Path) -> bool {
    if !dir.is_dir() {
        return false;
    }
    let data = child_ci(dir, "Data");
    child_ci(dir, "Game.ini").is_some()
        || data.as_ref().and_then(|d| child_ci(d, "Scripts.rxdata")).is_some()
        || (data.is_some() && child_ci(dir, "Graphics").is_some())
}

impl Registry {
    pub fn load(path: &Path) -> Registry {
        read_json::<Registry>(path).unwrap_or_default()
    }

    pub fn save(&self, path: &Path) -> std::io::Result<()> {
        write_json(path, self)
    }

    pub fn get(&self, id: &str) -> Option<&GameEntry> {
        self.games.iter().find(|g| g.id == id)
    }

    fn get_mut(&mut self, id: &str) -> Result<&mut GameEntry, RegistryError> {
        self.games.iter_mut().find(|g| g.id == id).ok_or_else(|| RegistryError::NotFound(id.to_string()))
    }

    /// Registra una carpeta de juego. Idempotente: si ya estaba, devuelve la que habia (`created = false`).
    pub fn add(&mut self, root: &Path, title: Option<String>, now: u64) -> Result<(&GameEntry, bool), RegistryError> {
        if !looks_like_game_root(root) {
            return Err(RegistryError::NotAGameFolder(root.to_string_lossy().into_owned()));
        }
        let id = game_id(root);
        if let Some(i) = self.games.iter().position(|g| g.id == id) {
            return Ok((&self.games[i], false));
        }
        let folder = root.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| root.to_string_lossy().into_owned());
        let name = title.clone().filter(|t| !t.trim().is_empty()).unwrap_or(folder);
        self.games.push(GameEntry {
            id,
            root: root.to_string_lossy().into_owned(),
            name,
            title,
            added_at: now,
            last_opened_at: None,
            save_dirs: Vec::new(),
            last_scan: None,
            indexed_at: None,
            fingerprint: None,
        });
        Ok((self.games.last().expect("recien anadido"), true))
    }

    pub fn remove(&mut self, id: &str) -> bool {
        let before = self.games.len();
        self.games.retain(|g| g.id != id);
        self.games.len() != before
    }

    pub fn rename(&mut self, id: &str, name: &str) -> Result<(), RegistryError> {
        let g = self.get_mut(id)?;
        let name = name.trim();
        if !name.is_empty() {
            g.name = name.to_string();
        }
        Ok(())
    }

    pub fn touch(&mut self, id: &str, now: u64) -> Result<(), RegistryError> {
        self.get_mut(id)?.last_opened_at = Some(now);
        Ok(())
    }

    /// Anade una carpeta de partidas elegida a mano (sin repetir).
    pub fn add_save_dir(&mut self, id: &str, dir: &str) -> Result<(), RegistryError> {
        let g = self.get_mut(id)?;
        if !g.save_dirs.iter().any(|d| norm(d) == norm(dir)) {
            g.save_dirs.push(dir.to_string());
        }
        Ok(())
    }

    pub fn remove_save_dir(&mut self, id: &str, dir: &str) -> Result<(), RegistryError> {
        self.get_mut(id)?.save_dirs.retain(|d| norm(d) != norm(dir));
        Ok(())
    }

    pub fn record_scan(&mut self, id: &str, scan: &ScanResult, now: u64) -> Result<(), RegistryError> {
        self.get_mut(id)?.last_scan = Some(LastScan { dir: scan.dir.clone(), source: scan.source, count: scan.files.len(), at: now });
        Ok(())
    }

    pub fn record_index(&mut self, id: &str, fingerprint: Option<String>, now: u64) -> Result<(), RegistryError> {
        let g = self.get_mut(id)?;
        g.indexed_at = Some(now);
        g.fingerprint = fingerprint;
        Ok(())
    }

    /// El juego al que pertenece una partida: la que esta en una de sus carpetas de guardado (manual o la del ultimo escaneo),
    /// o dentro de la carpeta del propio juego. Si varios encajan, el de la carpeta mas especifica.
    pub fn find_for_save(&self, save: &Path) -> Option<&GameEntry> {
        let save_norm = norm(&save.to_string_lossy());
        // El padre se saca del texto normalizado: asi sirve igual con rutas de Windows (`\`) estando en otro sistema.
        let parent = save_norm.rsplit_once('/')?.0.to_string();
        let mut best: Option<(&GameEntry, usize)> = None;
        for g in &self.games {
            let in_save_dir = g.save_dirs.iter().chain(g.last_scan.as_ref().and_then(|s| s.dir.as_ref())).any(|d| norm(d) == parent);
            let root = norm(&g.root);
            let in_root = save_norm.starts_with(&format!("{root}/"));
            // Una carpeta de guardado conocida pesa mas que estar dentro de la raiz del juego.
            let score = if in_save_dir { 1_000_000 + root.len() } else if in_root { root.len() } else { continue };
            if best.map_or(true, |(_, s)| score > s) {
                best = Some((g, score));
            }
        }
        best.map(|(g, _)| g)
    }

    /// Juegos ordenados para mostrarlos: el abierto mas recientemente primero, luego el anadido mas recientemente.
    pub fn sorted(&self) -> Vec<&GameEntry> {
        let mut v: Vec<&GameEntry> = self.games.iter().collect();
        v.sort_by(|a, b| {
            b.last_opened_at.cmp(&a.last_opened_at).then(b.added_at.cmp(&a.added_at)).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });
        v
    }

    /// Siembra la biblioteca con carpetas de juego ya conocidas (los «juegos recientes» de versiones anteriores).
    /// Solo entran las que existen y parecen un juego; devuelve cuantas se anadieron.
    pub fn seed(&mut self, roots: &[String], now: u64, title_of: impl Fn(&Path) -> Option<String>) -> usize {
        let mut added = 0;
        for r in roots {
            let p = Path::new(r);
            if looks_like_game_root(p) && self.add(p, title_of(p), now).map(|(_, created)| created).unwrap_or(false) {
                added += 1;
            }
        }
        added
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::savescan::game_title;
    use crate::testutil::Tmp;

    fn game(t: &Tmp, name: &str) -> std::path::PathBuf {
        t.write(&format!("{name}/Game.ini"), format!("[Game]\r\nTitle=Titulo de {name}\r\n").as_bytes());
        t.path().join(name)
    }

    #[test]
    fn el_id_es_estable_y_no_distingue_mayusculas_ni_separadores() {
        let a = game_id(Path::new("C:\\Juegos\\Anil"));
        assert_eq!(a, game_id(Path::new("c:/juegos/anil/")));
        assert_ne!(a, game_id(Path::new("C:\\Juegos\\Otro")));
        assert_eq!(a.len(), 16);
    }

    #[test]
    fn reconoce_la_carpeta_de_un_juego() {
        let t = Tmp::new("reg_root");
        let g = game(&t, "A");
        assert!(looks_like_game_root(&g));
        t.mkdir("B/Data");
        t.mkdir("B/graphics");
        assert!(looks_like_game_root(&t.path().join("B")), "Data + Graphics (sin distinguir mayusculas)");
        t.write("C/Data/scripts.RXDATA", b"x");
        assert!(looks_like_game_root(&t.path().join("C")));
        t.mkdir("D");
        assert!(!looks_like_game_root(&t.path().join("D")));
        assert!(!looks_like_game_root(&t.path().join("no-existe")));
    }

    #[test]
    fn anadir_es_idempotente_y_valida_la_carpeta() {
        let t = Tmp::new("reg_add");
        let g = game(&t, "Anil");
        let mut r = Registry::default();
        let (e, created) = r.add(&g, Some("El Añil".into()), 100).unwrap();
        assert!(created);
        assert_eq!((e.name.as_str(), e.added_at), ("El Añil", 100));
        let (_, again) = r.add(&g, None, 200).unwrap();
        assert!(!again);
        assert_eq!(r.games.len(), 1);
        assert_eq!(r.games[0].added_at, 100, "no se pisa el alta original");
        t.mkdir("vacia");
        assert!(matches!(r.add(&t.path().join("vacia"), None, 1), Err(RegistryError::NotAGameFolder(_))));
        // sin titulo usa el nombre de la carpeta
        let h = game(&t, "Otro");
        let (e2, _) = r.add(&h, None, 300).unwrap();
        assert_eq!(e2.name, "Otro");
    }

    #[test]
    fn renombrar_quitar_y_tocar() {
        let t = Tmp::new("reg_ops");
        let g = game(&t, "A");
        let mut r = Registry::default();
        let id = r.add(&g, None, 1).unwrap().0.id.clone();
        r.rename(&id, "  Mi juego favorito ").unwrap();
        assert_eq!(r.get(&id).unwrap().name, "Mi juego favorito");
        r.rename(&id, "   ").unwrap();
        assert_eq!(r.get(&id).unwrap().name, "Mi juego favorito", "un nombre vacio no borra el actual");
        r.touch(&id, 50).unwrap();
        assert_eq!(r.get(&id).unwrap().last_opened_at, Some(50));
        assert!(r.touch("nope", 1).is_err());
        assert!(r.remove(&id));
        assert!(!r.remove(&id));
    }

    #[test]
    fn las_carpetas_de_guardado_manuales_no_se_repiten() {
        let t = Tmp::new("reg_dirs");
        let g = game(&t, "A");
        let mut r = Registry::default();
        let id = r.add(&g, None, 1).unwrap().0.id.clone();
        r.add_save_dir(&id, "C:\\Users\\yo\\Mis Partidas").unwrap();
        r.add_save_dir(&id, "c:/users/yo/mis partidas/").unwrap();
        assert_eq!(r.get(&id).unwrap().save_dirs.len(), 1);
        r.remove_save_dir(&id, "C:/Users/yo/Mis Partidas").unwrap();
        assert!(r.get(&id).unwrap().save_dirs.is_empty());
    }

    #[test]
    fn encuentra_el_juego_de_una_partida_por_su_carpeta_de_guardado_o_por_estar_dentro_del_juego() {
        let t = Tmp::new("reg_find");
        let a = game(&t, "A");
        let b = game(&t, "B");
        let mut r = Registry::default();
        let ia = r.add(&a, None, 1).unwrap().0.id.clone();
        let ib = r.add(&b, None, 2).unwrap().0.id.clone();
        let scan = ScanResult { dir: Some("C:\\Users\\yo\\AppData\\Roaming\\Titulo de A".into()), source: Some(Source::AppData), files: vec![], candidates: vec![] };
        r.record_scan(&ia, &scan, 10).unwrap();
        r.add_save_dir(&ib, "D:\\Partidas B").unwrap();

        assert_eq!(r.find_for_save(Path::new("C:/Users/yo/AppData/Roaming/Titulo de A/Game.rxdata")).unwrap().id, ia);
        assert_eq!(r.find_for_save(Path::new("D:\\Partidas B\\Game2.rxdata")).unwrap().id, ib);
        let inside = a.join("Saves").join("Game.rxdata");
        assert_eq!(r.find_for_save(&inside).unwrap().id, ia, "dentro de la carpeta del juego");
        assert!(r.find_for_save(Path::new("E:/otro/Game.rxdata")).is_none());
    }

    #[test]
    fn una_carpeta_de_guardado_conocida_gana_a_estar_dentro_de_otro_juego() {
        let t = Tmp::new("reg_nested");
        let outer = game(&t, "Juegos");
        t.write("Juegos/Inner/Game.ini", b"[Game]\r\n");
        let inner = outer.join("Inner");
        let mut r = Registry::default();
        let io = r.add(&outer, None, 1).unwrap().0.id.clone();
        let ii = r.add(&inner, None, 2).unwrap().0.id.clone();
        assert_eq!(r.find_for_save(&inner.join("Game.rxdata")).unwrap().id, ii, "la raiz mas especifica");
        r.add_save_dir(&io, &inner.to_string_lossy()).unwrap();
        assert_eq!(r.find_for_save(&inner.join("Game.rxdata")).unwrap().id, io, "una carpeta de guardado declarada pesa mas");
    }

    #[test]
    fn se_guarda_y_se_lee_y_un_archivo_danado_se_ignora() {
        let t = Tmp::new("reg_io");
        let g = game(&t, "A");
        let path = t.path().join("datos").join("games.json");
        assert!(Registry::load(&path).games.is_empty());
        let mut r = Registry::default();
        let id = r.add(&g, Some("A".into()), 5).unwrap().0.id.clone();
        r.record_index(&id, Some("abc123".into()), 99).unwrap();
        r.save(&path).unwrap();
        let back = Registry::load(&path);
        assert_eq!(back, r);
        assert_eq!(back.get(&id).unwrap().fingerprint.as_deref(), Some("abc123"));
        fs::write(&path, b"{ roto").unwrap();
        assert!(Registry::load(&path).games.is_empty());
        // campos que faltan (archivo de una version anterior) toman su valor por defecto
        fs::write(&path, br#"{"games":[{"id":"x","root":"R","name":"N","title":null,"addedAt":1,"lastOpenedAt":null}]}"#).unwrap();
        let old = Registry::load(&path);
        assert_eq!(old.games.len(), 1);
        assert!(old.games[0].save_dirs.is_empty() && old.games[0].last_scan.is_none());
    }

    #[test]
    fn el_orden_pone_primero_el_juego_abierto_mas_recientemente() {
        let t = Tmp::new("reg_sort");
        let mut r = Registry::default();
        let ids: Vec<String> = ["A", "B", "C"].iter().enumerate().map(|(i, n)| r.add(&game(&t, n), None, i as u64 + 1).unwrap().0.id.clone()).collect();
        r.touch(&ids[0], 500).unwrap();
        let order: Vec<String> = r.sorted().iter().map(|g| g.name.clone()).collect();
        assert_eq!(order, ["A", "C", "B"]);
        assert_eq!(r.sorted()[0].id, ids[0]);
        assert_eq!(r.sorted()[1].id, ids[2], "sin abrir, el anadido mas reciente");
    }

    #[test]
    fn siembra_desde_los_juegos_recientes_solo_con_los_que_existen() {
        let t = Tmp::new("reg_seed");
        let a = game(&t, "A");
        let mut r = Registry::default();
        let roots = vec![a.to_string_lossy().into_owned(), t.path().join("borrada").to_string_lossy().into_owned(), a.to_string_lossy().into_owned()];
        assert_eq!(r.seed(&roots, 7, |p| game_title(p)), 1);
        assert_eq!(r.games[0].name, "Titulo de A");
    }
}
