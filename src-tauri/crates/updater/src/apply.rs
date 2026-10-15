//! Instalacion de la nueva version: extraer el zip a una carpeta de preparacion (con defensa contra rutas peligrosas), comprobar su
//! contenido contra `CONTENIDO.sha256` y reemplazar los archivos de la app guardando los antiguos para poder deshacerlo todo.

use crate::sums;
use crate::{Result, UpdateError};
use std::collections::BTreeSet;
use std::fs::{self, File, OpenOptions};
use std::io::{BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// Carpeta (dentro de la de la app, para que renombrar sea barato) donde se prepara la nueva version.
pub const STAGE_DIR: &str = ".peshex-update";
pub const BACKUP_PREFIX: &str = ".update-backup-";
pub const MANIFEST: &str = "CONTENIDO.sha256";

#[derive(Debug, Clone)]
pub struct Limits {
    pub max_entries: usize,
    /// Suma de los tamaños descomprimidos declarados.
    pub max_total: u64,
}

impl Default for Limits {
    fn default() -> Self {
        Limits { max_entries: 50_000, max_total: 3 * 1024 * 1024 * 1024 }
    }
}

/// Valida un nombre de entrada del zip y lo devuelve normalizado (`a/b/c`). Rechaza lo que podria salirse de la carpeta de destino.
pub fn safe_rel(name: &str) -> Result<String> {
    let bad = |why: &str| UpdateError::BadArchive(format!("ruta no permitida en el zip ({why}): {name}"));
    if name.is_empty() || name.contains('\0') {
        return Err(bad("vacia"));
    }
    if name.contains('\\') {
        return Err(bad("barra invertida"));
    }
    if name.starts_with('/') {
        return Err(bad("absoluta"));
    }
    let mut parts = Vec::new();
    for comp in name.split('/') {
        match comp {
            "" | "." => continue,
            ".." => return Err(bad("sube de carpeta")),
            c if c.contains(':') => return Err(bad("unidad o flujo alterno")),
            c if c.ends_with('.') || c.ends_with(' ') => return Err(bad("nombre que Windows altera")),
            c => parts.push(c),
        }
    }
    if parts.is_empty() {
        return Err(bad("vacia"));
    }
    Ok(parts.join("/"))
}

/// Extrae `zip_path` en `dest` (que debe estar vacia o no existir) y devuelve los archivos (rutas relativas, sin la carpeta raiz
/// `PESHeX-<v>-windows-x64/` si el zip la trae).
pub fn extract(zip_path: &Path, dest: &Path, limits: &Limits) -> Result<Vec<String>> {
    let mut archive = zip::ZipArchive::new(BufReader::new(File::open(zip_path)?))?;
    if archive.len() == 0 || archive.len() > limits.max_entries {
        return Err(UpdateError::BadArchive(format!("el zip tiene {} entradas", archive.len())));
    }

    // 1) Nombres y tamaños declarados, sin descomprimir nada.
    let mut entries: Vec<(usize, String, bool, u64)> = Vec::with_capacity(archive.len());
    let mut total = 0u64;
    for i in 0..archive.len() {
        let e = archive.by_index_raw(i)?;
        let rel = safe_rel(e.name())?;
        if let Some(mode) = e.unix_mode() {
            if mode & 0o170000 == 0o120000 {
                return Err(UpdateError::BadArchive(format!("enlace simbolico en el zip: {rel}")));
            }
        }
        total = total.saturating_add(e.size());
        entries.push((i, rel, e.is_dir(), e.size()));
    }
    if total > limits.max_total {
        return Err(UpdateError::BadArchive(format!("el zip descomprimido pesaria {total} bytes")));
    }

    // 2) Carpeta raiz comun (si todas las entradas cuelgan de la misma).
    let first = |r: &str| r.split('/').next().unwrap_or("").to_string();
    let top = first(&entries[0].1);
    let strip = !top.is_empty() && entries.iter().all(|(_, r, is_dir, _)| first(r) == top && (r.contains('/') || *is_dir));

    fs::create_dir_all(dest)?;
    let mut seen = BTreeSet::new();
    let mut files = Vec::new();
    let mut buf = vec![0u8; 128 * 1024];
    for (i, rel, is_dir, size) in entries {
        let rel = if strip { rel.strip_prefix(&format!("{top}/")).unwrap_or("").to_string() } else { rel };
        if rel.is_empty() {
            continue; // la propia carpeta raiz
        }
        let target = dest.join(&rel);
        if is_dir {
            fs::create_dir_all(&target)?;
            continue;
        }
        if !seen.insert(rel.clone()) {
            return Err(UpdateError::BadArchive(format!("entrada repetida en el zip: {rel}")));
        }
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)?;
        }
        let mut entry = archive.by_index(i)?;
        let mut out = OpenOptions::new().write(true).create_new(true).open(&target)?;
        let mut written = 0u64;
        loop {
            // El lector del zip comprueba el CRC-32 al llegar al final; el tope impide que una entrada mienta sobre su tamaño.
            let n = entry.read(&mut buf).map_err(|e| UpdateError::BadArchive(format!("{rel}: {e}")))?;
            if n == 0 {
                break;
            }
            written += n as u64;
            if written > size {
                return Err(UpdateError::BadArchive(format!("{rel} es mas grande de lo que declara")));
            }
            out.write_all(&buf[..n])?;
        }
        if written != size {
            return Err(UpdateError::BadArchive(format!("{rel} esta incompleto")));
        }
        files.push(rel);
    }
    files.sort();
    Ok(files)
}

/// Archivos de `dir` (rutas relativas con `/`), recursivo y sin seguir enlaces.
pub fn list_files(dir: &Path) -> Result<Vec<String>> {
    fn rec(base: &Path, dir: &Path, out: &mut Vec<String>) -> std::io::Result<()> {
        for e in fs::read_dir(dir)? {
            let e = e?;
            let ft = e.file_type()?;
            let p = e.path();
            if ft.is_dir() {
                rec(base, &p, out)?;
            } else if ft.is_file() {
                let rel = p.strip_prefix(base).unwrap_or(&p).components().map(|c| c.as_os_str().to_string_lossy().into_owned()).collect::<Vec<_>>().join("/");
                out.push(rel);
            }
        }
        Ok(())
    }
    let mut out = Vec::new();
    rec(dir, dir, &mut out)?;
    out.sort();
    Ok(out)
}

/// Comprueba la carpeta preparada: tiene el ejecutable, todo lo que declara `CONTENIDO.sha256` coincide y no sobra nada.
/// Devuelve la lista de archivos del paquete (incluido `CONTENIDO.sha256`).
pub fn validate(stage: &Path, main_exe: &str) -> Result<Vec<String>> {
    let text = fs::read_to_string(stage.join(MANIFEST)).map_err(|_| UpdateError::BadArchive(format!("falta {MANIFEST}")))?;
    let listed = sums::parse(&text);
    if !listed.iter().any(|(_, n)| n == main_exe) {
        return Err(UpdateError::BadArchive(format!("{MANIFEST} no incluye {main_exe}")));
    }
    for (hash, name) in &listed {
        let rel = safe_rel(name)?;
        let path = stage.join(&rel);
        let actual = sums::sha256_file(&path).map_err(|_| UpdateError::BadArchive(format!("falta {rel}")))?;
        if actual != *hash {
            return Err(UpdateError::BadArchive(format!("{rel} no coincide con {MANIFEST}")));
        }
    }
    let declared: BTreeSet<&str> = listed.iter().map(|(_, n)| n.as_str()).collect();
    let on_disk = list_files(stage)?;
    if let Some(extra) = on_disk.iter().find(|f| f.as_str() != MANIFEST && !declared.contains(f.as_str())) {
        return Err(UpdateError::BadArchive(format!("{extra} no esta en {MANIFEST}")));
    }
    Ok(on_disk)
}

/// Archivos de la version instalada segun su `CONTENIDO.sha256` (vacio si no lo hay: entonces no se borra nada).
pub fn installed_files(app_dir: &Path) -> Vec<String> {
    let Ok(text) = fs::read_to_string(app_dir.join(MANIFEST)) else { return Vec::new() };
    let mut v: Vec<String> = sums::parse(&text).into_iter().filter_map(|(_, n)| safe_rel(&n).ok()).collect();
    if !v.iter().any(|n| n == MANIFEST) && !v.is_empty() {
        v.push(MANIFEST.to_string());
    }
    v
}

/// Comprueba que se puede escribir en la carpeta de la app creando y borrando un archivo.
pub fn check_writable(dir: &Path) -> Result<()> {
    let probe = dir.join(".peshex-write-test");
    fs::write(&probe, b"x").map_err(|e| UpdateError::NotWritable(format!("{}: {e}", dir.display())))?;
    let _ = fs::remove_file(&probe);
    Ok(())
}

/// Espera a que `path` se pueda abrir para escribir: mientras PESHeX.exe sigue en ejecucion Windows no lo permite.
pub fn wait_until_writable(path: &Path, total: Duration, poll: Duration) -> Result<()> {
    if !path.exists() {
        return Ok(());
    }
    let deadline = Instant::now() + total;
    loop {
        match OpenOptions::new().write(true).open(path) {
            Ok(_) => return Ok(()),
            Err(e) => {
                if Instant::now() >= deadline {
                    return Err(UpdateError::NotWritable(format!("{} sigue en uso ({e}); cierra PESHeX e intentalo de nuevo", path.display())));
                }
                std::thread::sleep(poll);
            }
        }
    }
}

#[derive(Debug, Clone)]
pub struct SwapOptions {
    /// Cuanto reintentar un archivo bloqueado (antivirus, un proceso que acaba de cerrar...).
    pub lock_wait: Duration,
    pub poll: Duration,
}

impl Default for SwapOptions {
    fn default() -> Self {
        SwapOptions { lock_wait: Duration::from_secs(60), poll: Duration::from_millis(250) }
    }
}

/// Renombra reintentando mientras el archivo este bloqueado; si no se puede renombrar entre volumenes, copia y borra.
fn move_file(from: &Path, to: &Path, opt: &SwapOptions) -> std::io::Result<()> {
    let deadline = Instant::now() + opt.lock_wait;
    loop {
        match fs::rename(from, to) {
            Ok(()) => return Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Err(e),
            // Otro volumen (un enlace en medio): no es un bloqueo, no tiene sentido esperar.
            Err(e) if e.kind() == std::io::ErrorKind::CrossesDevices => return fs::copy(from, to).and_then(|_| fs::remove_file(from)).map_err(|_| e),
            Err(e) => {
                if Instant::now() >= deadline {
                    // Ultimo recurso (otro volumen): copiar y borrar el origen.
                    return match fs::copy(from, to) {
                        Ok(_) => fs::remove_file(from),
                        Err(_) => Err(e),
                    };
                }
                std::thread::sleep(opt.poll);
            }
        }
    }
}

#[derive(Debug)]
enum Step {
    /// El archivo antiguo `rel` se movio a la copia de seguridad.
    Saved(String),
    /// El archivo nuevo `rel` se coloco en la carpeta de la app.
    Placed(String),
}

/// Reemplazo en curso: permite deshacerlo (`rollback`) o darlo por bueno (`commit`).
#[derive(Debug)]
pub struct Swap {
    app_dir: PathBuf,
    backup: PathBuf,
    journal: Vec<Step>,
    opt: SwapOptions,
}

impl Swap {
    /// Vuelve la carpeta al estado anterior: quita lo colocado y devuelve lo guardado.
    pub fn rollback(&mut self) -> Result<()> {
        let mut first_err = None;
        while let Some(step) = self.journal.pop() {
            let r = match &step {
                Step::Placed(rel) => match fs::remove_file(self.app_dir.join(rel)) {
                    Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e),
                    _ => Ok(()),
                },
                Step::Saved(rel) => {
                    let to = self.app_dir.join(rel);
                    if let Some(p) = to.parent() {
                        let _ = fs::create_dir_all(p);
                    }
                    move_file(&self.backup.join(rel), &to, &self.opt)
                }
            };
            if let Err(e) = r {
                first_err.get_or_insert(UpdateError::Io(format!("no se pudo deshacer {step:?}: {e}")));
            }
        }
        match first_err {
            None => {
                let _ = fs::remove_dir_all(&self.backup);
                Ok(())
            }
            Some(e) => Err(e),
        }
    }

    /// Da el reemplazo por bueno y borra la copia de seguridad.
    pub fn commit(self) {
        let _ = fs::remove_dir_all(&self.backup);
    }

    pub fn backup_dir(&self) -> &Path {
        &self.backup
    }
}

/// Mueve los archivos de `stage` a `app_dir` (guardando antes los que sustituyen) y retira los de `old_files` que ya no existen.
/// Si algo falla, lo deshace antes de devolver el error. `new_files` son rutas relativas con `/`.
pub fn swap(app_dir: &Path, stage: &Path, new_files: &[String], old_files: &[String], main_exe: &str, tag: &str, opt: &SwapOptions) -> Result<Swap> {
    let backup = app_dir.join(format!("{BACKUP_PREFIX}{tag}"));
    let mut sw = Swap { app_dir: app_dir.to_path_buf(), backup, journal: Vec::new(), opt: opt.clone() };

    // El ejecutable y el manifiesto van los ultimos: si el reemplazo se interrumpe, lo mas probable es que siga arrancando la version anterior.
    let mut order: Vec<&String> = new_files.iter().filter(|f| f.as_str() != main_exe && f.as_str() != MANIFEST).collect();
    order.extend(new_files.iter().filter(|f| f.as_str() == main_exe));
    order.extend(new_files.iter().filter(|f| f.as_str() == MANIFEST));

    let result = (|| -> Result<()> {
        for rel in order {
            safe_rel(rel)?;
            let dst = app_dir.join(rel);
            if dst.is_file() {
                let saved = sw.backup.join(rel);
                if let Some(p) = saved.parent() {
                    fs::create_dir_all(p)?;
                }
                move_file(&dst, &saved, opt).map_err(|e| UpdateError::NotWritable(format!("{rel}: {e}")))?;
                sw.journal.push(Step::Saved(rel.clone()));
            } else if dst.exists() {
                return Err(UpdateError::Io(format!("{rel} existe y no es un archivo")));
            }
            if let Some(p) = dst.parent() {
                fs::create_dir_all(p)?;
            }
            move_file(&stage.join(rel), &dst, opt).map_err(|e| UpdateError::Io(format!("{rel}: {e}")))?;
            sw.journal.push(Step::Placed(rel.clone()));
        }
        // Lo que traia la version anterior y la nueva ya no incluye.
        let keep: BTreeSet<&str> = new_files.iter().map(String::as_str).collect();
        for rel in old_files.iter().filter(|f| !keep.contains(f.as_str())) {
            safe_rel(rel)?;
            let old = app_dir.join(rel);
            if old.is_file() {
                let saved = sw.backup.join(rel);
                if let Some(p) = saved.parent() {
                    fs::create_dir_all(p)?;
                }
                move_file(&old, &saved, opt).map_err(|e| UpdateError::NotWritable(format!("{rel}: {e}")))?;
                sw.journal.push(Step::Saved(rel.clone()));
            }
        }
        Ok(())
    })();

    match result {
        Ok(()) => {
            prune_empty_dirs(app_dir, old_files);
            Ok(sw)
        }
        Err(e) => match sw.rollback() {
            Ok(()) => Err(e),
            Err(r) => Err(UpdateError::Io(format!("{e}; ademas {r}"))),
        },
    }
}

/// Quita las carpetas que quedaron vacias al retirar archivos viejos (de la mas honda a la mas alta; nunca `app_dir`).
fn prune_empty_dirs(app_dir: &Path, removed: &[String]) {
    let mut dirs = BTreeSet::new();
    for rel in removed {
        let mut p = Path::new(rel).parent();
        while let Some(d) = p {
            if d.as_os_str().is_empty() {
                break;
            }
            dirs.insert(d.to_path_buf());
            p = d.parent();
        }
    }
    let mut dirs: Vec<_> = dirs.into_iter().collect();
    dirs.sort_by_key(|d| std::cmp::Reverse(d.components().count()));
    for d in dirs {
        let _ = fs::remove_dir(app_dir.join(d)); // solo borra si esta vacia
    }
}

/// Restos de una actualizacion anterior interrumpida.
pub fn cleanup_leftovers(app_dir: &Path) {
    let _ = fs::remove_dir_all(app_dir.join(STAGE_DIR));
    if let Ok(rd) = fs::read_dir(app_dir) {
        for e in rd.flatten() {
            if e.file_name().to_string_lossy().starts_with(BACKUP_PREFIX) {
                let _ = fs::remove_dir_all(e.path());
            }
        }
    }
}

/// Arranca la app ya actualizada, desligada de este proceso.
pub fn relaunch(app_dir: &Path, main_exe: &str) -> Result<()> {
    let mut cmd = Command::new(app_dir.join(main_exe));
    cmd.current_dir(app_dir).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        cmd.creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP);
    }
    cmd.spawn().map(|_| ()).map_err(|e| UpdateError::Io(format!("no se pudo iniciar {main_exe}: {e}")))
}
