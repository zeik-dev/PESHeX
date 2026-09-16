use std::fs;
use std::path::Path;

/// Copia edit_rxdata.rb + driver/rxdata_driver.rb a resources/rxdata/ en
/// cada build, preservando la relacion de carpetas driver/../edit_rxdata.rb
/// (asi el `require_relative '../edit_rxdata.rb'` del driver resuelve igual
/// en dev que empaquetado, sin tocar el script). Nunca hay que sincronizar
/// esto a mano ni arriesgarse a que la copia empaquetada quede vieja.
fn main() {
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR");
    let src_tauri = Path::new(&manifest_dir);
    let repo_root = src_tauri
        .parent()
        .expect("src-tauri debe estar dentro del repo");

    let edit_rxdata = repo_root.join("edit_rxdata.rb");
    let driver_script = repo_root.join("driver").join("rxdata_driver.rb");

    let dest_root = src_tauri.join("resources").join("rxdata");
    let dest_driver_dir = dest_root.join("driver");
    fs::create_dir_all(&dest_driver_dir).expect("no se pudo crear resources/rxdata/driver");

    copy_tracked(&edit_rxdata, &dest_root.join("edit_rxdata.rb"));
    copy_tracked(&driver_script, &dest_driver_dir.join("rxdata_driver.rb"));

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
