use std::fs;
use std::path::Path;

/// Copia edit_rxdata.rb + driver/** a resources/rxdata/ en cada build,
/// preservando la relacion de carpetas driver/../edit_rxdata.rb (asi el
/// `require_relative '../edit_rxdata.rb'` del driver resuelve igual en dev
/// que empaquetado, sin tocar el script). Nunca hay que sincronizar esto a
/// mano ni arriesgarse a que la copia empaquetada quede vieja.
///
/// Tambien crea `resources/ruby/` si falta: Tauri valida que exista incluso
/// para `cargo check` (el Ruby portatil lo llena scripts/setup-ruby.ps1).
fn main() {
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR");
    let src_tauri = Path::new(&manifest_dir);
    let repo_root = src_tauri
        .parent()
        .expect("src-tauri debe estar dentro del repo");

    let dest_root = src_tauri.join("resources").join("rxdata");
    fs::create_dir_all(&dest_root).expect("no se pudo crear resources/rxdata");
    fs::create_dir_all(src_tauri.join("resources").join("ruby"))
        .expect("no se pudo crear resources/ruby");

    copy_tracked(
        &repo_root.join("edit_rxdata.rb"),
        &dest_root.join("edit_rxdata.rb"),
    );
    copy_dir_tracked(&repo_root.join("driver"), &dest_root.join("driver"));

    tauri_build::build()
}

fn copy_tracked(src: &Path, dest: &Path) {
    fs::copy(src, dest).unwrap_or_else(|e| {
        panic!(
            "no se pudo copiar {} -> {}: {e}",
            src.display(),
            dest.display()
        )
    });
    println!("cargo:rerun-if-changed={}", src.display());
}

/// Copia recursiva de `src` a `dest` (solo archivos; `dest` se crea si falta)
/// y avisa a cargo de cada archivo y carpeta para re-ejecutar el build.
fn copy_dir_tracked(src: &Path, dest: &Path) {
    fs::create_dir_all(dest)
        .unwrap_or_else(|e| panic!("no se pudo crear {}: {e}", dest.display()));
    println!("cargo:rerun-if-changed={}", src.display());
    let entries = fs::read_dir(src)
        .unwrap_or_else(|e| panic!("no se pudo leer {}: {e}", src.display()));
    for entry in entries.flatten() {
        let path = entry.path();
        let target = dest.join(entry.file_name());
        if path.is_dir() {
            copy_dir_tracked(&path, &target);
        } else {
            copy_tracked(&path, &target);
        }
    }
}
