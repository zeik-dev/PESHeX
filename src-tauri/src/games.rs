//! Biblioteca de juegos («Mis juegos»): registro de los fangames del usuario, Save Scan (donde guarda las partidas cada uno)
//! y precarga de sus datos. La logica esta en `peshex_core` (registro, escaneo de guardados) y en el driver Ruby (la cache de
//! datos del juego); aqui solo se conectan con Tauri.
//!
//! PESHeX solo LEE las carpetas del juego y de guardado: nunca escribe en ellas.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use peshex_core::registry::{game_id, GameEntry, Registry, RegistryError};
use peshex_core::savescan::{self, ScanInput, ScanResult};
use rxdriver::DriverErrorDto;
use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

use crate::commands::spawn_session;
use crate::game::{game_cache_dir, scan_graphics_cached, MAX_FILES};

/// Evento con el progreso real de «Precargar» (`{ id, step, done, total }`; al terminar, `{ id, done: true, ... }`).
const PRELOAD_EVENT: &str = "games://preload";

/// Serializa lecturas y escrituras de `games.json` (varias ordenes de la UI pueden llegar a la vez).
static REGISTRY_LOCK: Mutex<()> = Mutex::new(());
/// Juegos que se estan precargando ahora (no se lanza dos veces la misma precarga).
static PRELOADING: Mutex<Vec<String>> = Mutex::new(Vec::new());

fn err(kind: &str, msg: impl Into<String>) -> DriverErrorDto {
    DriverErrorDto::new(kind, msg)
}

fn registry_error(e: RegistryError) -> DriverErrorDto {
    match e {
        RegistryError::NotAGameFolder(p) => err("NotAGameFolder", format!("la carpeta no parece un juego de Pokémon Essentials: {p}")),
        RegistryError::NotFound(id) => err("GameNotFound", format!("no hay ningún juego registrado con el id {id}")),
    }
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn data_dir(app: &AppHandle) -> Result<PathBuf, DriverErrorDto> {
    app.path().app_data_dir().map_err(|e| err("AppDataDir", format!("no se pudo resolver el directorio de datos: {e}")))
}

fn registry_path(app: &AppHandle) -> Result<PathBuf, DriverErrorDto> {
    Ok(data_dir(app)?.join("games.json"))
}

/// Carga la biblioteca, aplica `f` y la guarda (todo bajo el cerrojo).
fn with_registry<T>(app: &AppHandle, f: impl FnOnce(&mut Registry) -> Result<T, DriverErrorDto>) -> Result<T, DriverErrorDto> {
    let path = registry_path(app)?;
    let _guard = REGISTRY_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut reg = Registry::load(&path);
    let out = f(&mut reg)?;
    reg.save(&path).map_err(|e| err("Io", format!("no se pudo guardar la biblioteca de juegos: {e}")))?;
    Ok(out)
}

/// Carpetas donde buscar `<nombre del juego>` (`%APPDATA%`, `%LOCALAPPDATA%`, `Saved Games`, Documentos).
fn scan_bases(app: &AppHandle) -> Vec<PathBuf> {
    let p = app.path();
    let mut bases: Vec<PathBuf> = Vec::new();
    for d in [p.data_dir(), p.local_data_dir()].into_iter().flatten() {
        bases.push(d);
    }
    if let Ok(home) = p.home_dir() {
        bases.push(home.join("Saved Games"));
    }
    if let Ok(docs) = p.document_dir() {
        bases.push(docs);
    }
    bases
}

fn scan_entry(app: &AppHandle, g: &GameEntry) -> ScanResult {
    let root = PathBuf::from(&g.root);
    let manual: Vec<PathBuf> = g.save_dirs.iter().map(PathBuf::from).collect();
    let bases = scan_bases(app);
    savescan::scan_saves(&ScanInput { root: &root, title: g.title.as_deref(), data_dirs: &bases, manual: &manual })
}

/// Ejecuta trabajo de disco fuera del hilo principal de la UI.
async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T, DriverErrorDto> + Send + 'static) -> Result<T, DriverErrorDto> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| err("Internal", e.to_string()))?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameAdded {
    pub game: GameEntry,
    pub created: bool,
    pub scan: ScanResult,
}

fn find(reg: &Registry, id: &str) -> Result<GameEntry, DriverErrorDto> {
    reg.get(id).cloned().ok_or_else(|| registry_error(RegistryError::NotFound(id.to_string())))
}

// ── Comandos ─────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn games_list(app: AppHandle) -> Result<Vec<GameEntry>, DriverErrorDto> {
    blocking(move || with_registry(&app, |r| Ok(r.sorted().into_iter().cloned().collect()))).await
}

/// Registra una carpeta de juego y busca sus partidas. Idempotente (si ya estaba, devuelve la existente y vuelve a escanear).
#[tauri::command]
pub async fn games_add(app: AppHandle, root: String) -> Result<GameAdded, DriverErrorDto> {
    blocking(move || {
        let root_path = PathBuf::from(&root);
        let title = savescan::game_title(&root_path);
        let (game, created) = with_registry(&app, |r| {
            let (g, created) = r.add(&root_path, title, now()).map_err(registry_error)?;
            Ok((g.clone(), created))
        })?;
        let scan = scan_entry(&app, &game);
        let game = with_registry(&app, |r| {
            r.record_scan(&game.id, &scan, now()).map_err(registry_error)?;
            find(r, &game.id)
        })?;
        Ok(GameAdded { game, created, scan })
    })
    .await
}

#[tauri::command]
pub async fn games_remove(app: AppHandle, id: String) -> Result<(), DriverErrorDto> {
    blocking(move || {
        with_registry(&app, |r| {
            r.remove(&id);
            Ok(())
        })?;
        // La cache de datos de ese juego ya no sirve a nadie.
        let _ = std::fs::remove_dir_all(data_dir(&app)?.join("gamecache").join(&id));
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn games_rename(app: AppHandle, id: String, name: String) -> Result<(), DriverErrorDto> {
    blocking(move || with_registry(&app, |r| r.rename(&id, &name).map_err(registry_error))).await
}

/// Marca el juego como abierto ahora (para ordenarlos).
#[tauri::command]
pub async fn games_touch(app: AppHandle, id: String) -> Result<(), DriverErrorDto> {
    blocking(move || with_registry(&app, |r| r.touch(&id, now()).map_err(registry_error))).await
}

/// Vuelve a buscar las partidas de un juego (y recuerda el resultado).
#[tauri::command]
pub async fn games_scan_saves(app: AppHandle, id: String) -> Result<ScanResult, DriverErrorDto> {
    blocking(move || rescan(&app, &id)).await
}

fn rescan(app: &AppHandle, id: &str) -> Result<ScanResult, DriverErrorDto> {
    let game = with_registry(app, |r| find(r, id))?;
    let scan = scan_entry(app, &game);
    with_registry(app, |r| r.record_scan(id, &scan, now()).map_err(registry_error))?;
    Ok(scan)
}

/// Anade una carpeta de guardado elegida a mano (cuando el Save Scan no encuentra las partidas) y vuelve a escanear.
#[tauri::command]
pub async fn games_add_save_dir(app: AppHandle, id: String, dir: String) -> Result<ScanResult, DriverErrorDto> {
    blocking(move || {
        if !Path::new(&dir).is_dir() {
            return Err(err("InvalidPath", format!("no existe la carpeta '{dir}'")));
        }
        with_registry(&app, |r| r.add_save_dir(&id, &dir).map_err(registry_error))?;
        rescan(&app, &id)
    })
    .await
}

#[tauri::command]
pub async fn games_remove_save_dir(app: AppHandle, id: String, dir: String) -> Result<ScanResult, DriverErrorDto> {
    blocking(move || {
        with_registry(&app, |r| r.remove_save_dir(&id, &dir).map_err(registry_error))?;
        rescan(&app, &id)
    })
    .await
}

/// El juego registrado al que pertenece una partida (por su carpeta de guardado o por estar dentro del juego).
#[tauri::command]
pub async fn games_find_for_save(app: AppHandle, path: String) -> Result<Option<GameEntry>, DriverErrorDto> {
    blocking(move || with_registry(&app, |r| Ok(r.find_for_save(Path::new(&path)).cloned()))).await
}

/// Siembra la biblioteca con carpetas de juego ya conocidas (los «juegos recientes» de versiones anteriores).
#[tauri::command]
pub async fn games_seed(app: AppHandle, roots: Vec<String>) -> Result<usize, DriverErrorDto> {
    blocking(move || with_registry(&app, |r| Ok(r.seed(&roots, now(), |p| savescan::game_title(p))))).await
}

/// Carpeta de cache de datos de un juego (para que el driver Ruby guarde ahi los datos ya leidos).
#[tauri::command]
pub fn games_cache_dir(app: AppHandle, root: String) -> Result<String, DriverErrorDto> {
    Ok(game_cache_dir(&data_dir(&app)?, Path::new(&root)).to_string_lossy().into_owned())
}

/// Precarga un juego: lee sus datos (y deja la cache del driver lista) y el indice de imagenes, SIN abrir ninguna partida.
/// Emite `games://preload` con el progreso real. Cargar un fangame grande puede tardar varios minutos.
#[tauri::command]
pub async fn games_preload(app: AppHandle, id: String) -> Result<Value, DriverErrorDto> {
    let game = blocking({
        let (app, id) = (app.clone(), id.clone());
        move || with_registry(&app, |r| find(r, &id))
    })
    .await?;
    {
        let mut busy = PRELOADING.lock().unwrap_or_else(|e| e.into_inner());
        if busy.contains(&id) {
            return Err(err("Busy", "este juego ya se está precargando"));
        }
        busy.push(id.clone());
    }
    let result = preload(&app, &game).await;
    PRELOADING.lock().unwrap_or_else(|e| e.into_inner()).retain(|x| x != &id);
    result
}

async fn preload(app: &AppHandle, game: &GameEntry) -> Result<Value, DriverErrorDto> {
    let root = PathBuf::from(&game.root);
    let cache_dir = game_cache_dir(&data_dir(app)?, &root);
    let emit = |step: &str, done: usize, total: usize| {
        let _ = app.emit(PRELOAD_EVENT, json!({ "id": game.id, "step": step, "done": done, "total": total }));
    };

    let mut session = spawn_session(app).await?;
    let outcome: Result<Value, DriverErrorDto> = async {
        let begin = session
            .call("game_preload_begin", json!({ "path": game.root, "cacheDir": cache_dir.to_string_lossy() }))
            .await
            .map_err(|e| e.to_dto())?;
        let steps: Vec<String> = begin
            .get("steps")
            .and_then(Value::as_array)
            .map(|a| a.iter().filter_map(|s| s.as_str().map(str::to_string)).collect())
            .unwrap_or_default();
        // + 1 por el indice de imagenes (Rust)
        let total = steps.len() + 1;
        for (i, step) in steps.iter().enumerate() {
            emit(step, i, total);
            session.call("game_preload_step", json!({ "step": step })).await.map_err(|e| e.to_dto())?;
        }
        emit("graphics", steps.len(), total);
        let finish = session.call("game_preload_finish", json!({})).await.map_err(|e| e.to_dto())?;
        Ok(finish)
    }
    .await;
    session.shutdown().await;
    let finish = outcome?;

    // Imagenes: el indice incremental deja listo graphics.json (la proxima vez solo se abren las nuevas).
    let graphics_cache = cache_dir.join("graphics.json");
    let root_for_scan = root.clone();
    blocking(move || scan_graphics_cached(&root_for_scan, MAX_FILES, Some(&graphics_cache)).map(|_| ())).await?;

    let fingerprint = finish.get("fingerprint").and_then(Value::as_str).map(str::to_string);
    let id = game.id.clone();
    let app2 = app.clone();
    blocking(move || with_registry(&app2, |r| r.record_index(&id, fingerprint, now()).map_err(registry_error))).await?;
    let _ = app.emit(PRELOAD_EVENT, json!({ "id": game.id, "done": true, "total": 1 }));
    Ok(json!({ "id": game.id, "cached": finish.get("cached").cloned().unwrap_or(Value::Bool(false)), "state": finish.get("state").cloned() }))
}

/// Ids de los juegos que se estan precargando (para que la UI recupere el estado tras recargar la vista).
#[tauri::command]
pub fn games_preloading() -> Vec<String> {
    PRELOADING.lock().unwrap_or_else(|e| e.into_inner()).clone()
}

/// Id de un juego a partir de su carpeta (el mismo hash que usa el registro).
#[tauri::command]
pub fn games_id_of(root: String) -> String {
    game_id(Path::new(&root))
}
