# PBS Editor

App de escritorio (Tauri + React + TypeScript) para navegar y editar
partidas `.rxdata` de Pokémon Essentials / RPG Maker XP, usando
[`edit_rxdata.rb`](edit_rxdata.rb) como motor de lectura/escritura.

`edit_rxdata.rb` nunca se modifica: la app le habla a través de un driver
Ruby nuevo ([`driver/rxdata_driver.rb`](driver/rxdata_driver.rb)) que lo usa
como librería y expone un protocolo JSON por línea sobre stdin/stdout. El
backend Rust (`src-tauri/`) lanza ese driver como proceso hijo persistente
por archivo abierto; el frontend React solo habla con comandos de Tauri.

v1 apunta solo a Windows: la app empaqueta su propio Ruby portátil (sin
depender de que el usuario final tenga Ruby instalado).

## Setup (una sola vez, en Windows)

1. Instalá [7-Zip](https://www.7-zip.org/) (hace falta para extraer el Ruby
   portátil - solo en esta máquina de desarrollo/build, no en la del usuario
   final).
2. Corré el script que descarga y extrae el Ruby portátil:

   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts/setup-ruby.ps1
   ```

   Esto llena `src-tauri/resources/ruby/` (ignorado por git). Es
   idempotente: si ya está la versión correcta, no vuelve a descargar nada.
3. Instalá las dependencias del frontend:

   ```bash
   npm install
   ```

## Desarrollo

```bash
npm run tauri dev
```

`build.rs` copia automáticamente `edit_rxdata.rb` y
`driver/rxdata_driver.rb` a `src-tauri/resources/rxdata/` en cada build -
nunca hace falta sincronizar eso a mano.

En Linux/macOS (sin Ruby portátil instalado) el backend cae automáticamente
al `ruby` del sistema si lo encuentra en el PATH, lo cual sirve para
desarrollar la capa Rust/React contra el driver real sin necesitar Windows -
pero el build final para distribuir siempre usa el Ruby embebido de
Windows.

## Probar el driver Ruby de forma aislada

El protocolo JSON del driver se puede probar sin Tauri, pipeando comandos
por stdin:

```bash
ruby driver/rxdata_driver.rb <<'EOF'
{"id":1,"cmd":"open","path":"test_saves/Partida_2.rxdata"}
{"id":2,"cmd":"list_fields","page":0,"pageSize":5}
{"id":3,"cmd":"shutdown"}
EOF
```

Antes de editar una partida real, conviene validar que reconstruye
idéntica byte a byte:

```bash
ruby driver/rxdata_driver.rb <<'EOF'
{"id":1,"cmd":"check","path":"ruta/a/Partida.rxdata"}
EOF
```

## Build de producción (Windows)

```bash
npm run tauri build
```

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
