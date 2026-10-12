<p align="center"><img src="branding/PESHeX.png" alt="PESHeX" width="160" /></p>

# PESHeX — Pokémon Essential HeX

Editor **visual** de partidas guardadas (`.rxdata`) de **Pokémon Essentials** y
fangames basados en él. Detecta automáticamente qué base de Essentials usa la
partida (v16–v21 y bases personalizadas como *La Base de Sky*) y muestra el
entrenador, el equipo, el PC, la mochila, los IV/EV, los movimientos… en
pestañas sencillas, en **español** e **inglés**, con una interfaz inspirada en
una Poké Ball.

> Herramienta de fans, sin afiliación con Nintendo, Game Freak ni The Pokémon
> Company. Pokémon y Poké Ball son marcas de sus respectivos propietarios.

## Qué hace

| Pestaña | Contenido |
|---|---|
| **Resumen** | Entrenador, dinero, medallas, tiempo de juego, equipo, cifras (PC, Pokédex…), base detectada y cobertura de clasificación |
| **Entrenador** | Nombre, dinero, fichas, puntos de combate, hollín, medallas y datos extra de la base |
| **Equipo** | Tarjetas de los Pokémon y editor lateral: nivel, apodo, naturaleza, habilidad, objeto, **IV/EV** (con acciones rápidas), movimientos, datos del dueño y extras personalizados |
| **PC** | Cajas con sus Pokémon (mismo editor) |
| **Mochila** | Bolsillos, búsqueda, cantidades, añadir/quitar objetos, favoritos |
| **Todo detectado** | Lista completa de lo que contiene la partida y cómo se clasificó (*clasificado · personalizado · mundo y motor · sin clasificar*). Nada se pierde |
| **Cambios** | Cambios sin guardar, con deshacer/rehacer |
| **Avanzado** | Todos los campos crudos del archivo (el explorador original), con filtro por ruta/tipo |
| **Ajustes** | Idioma (auto/ES/EN), tema (auto/claro/oscuro), color de Poké Ball, copia de seguridad, detección de la base |

- **Seguro:** guardar crea siempre una copia `.bak`, los valores fuera de los
  límites normales piden confirmación (las bases personalizadas pueden
  cambiarlos), y *editar + deshacer todo* devuelve el archivo byte a byte.
- **Sin datos del juego** (de momento) los nombres de especies, objetos y
  movimientos son el ID interno embellecido (`OLDAMBER` → «Oldamber») o el
  nombre que la propia partida lleve embebido. Los sprites y los nombres reales
  llegarán al elegir la carpeta del juego (ver *Hoja de ruta*).

## Cómo detecta la base

`driver/semantic/` no depende de nombres de variable: reconoce **qué es cada
cosa por su forma**.

1. *Perfiles* (`essentials_savedata` v19–v21, `essentials_legacy` v16–v18,
   `generic`) puntúan la partida según la forma de la raíz, la versión, las
   clases y el estilo de IDs.
2. *Descubrimiento de roles*: «Pokémon» = objeto con especie + nivel/exp +
   movimientos; «bolsa» = array de bolsillos con pares `[id, cantidad]`
   (`@pockets`, `@bag`…); «PC» = array de cajas con casillas de Pokémon;
   «entrenador» = objeto con `@party` y nombre.
3. Confianza **alta / media / baja**. Si es baja, la partida queda en *solo
   lectura* hasta que confirmes el perfil en Ajustes.
4. Lo que ningún rol reclama se reparte en los *buckets* de cobertura y se ve
   en «Todo detectado».

> Los perfiles v16–v18 están basados en conocimiento del motor y probados con
> **saves sintéticos** (`test/fixtures/make_legacy_save.rb`). Si tienes saves
> reales de otras bases (Reborn, Rejuvenation, Infinite Fusion, v16/v17/v18…),
> compártelos para afinar los perfiles.

## Arquitectura

```
React 19 + TS (src/)  ──invoke──►  Tauri 2 / Rust (src-tauri/)  ──JSON por línea──►  Ruby (driver/)
 i18n, tema, vistas                 driver_call genérico                              edit_rxdata.rb + capa semántica
```

- **`edit_rxdata.rb`** (no se modifica): lector/escritor Marshal con
  roundtrip byte a byte, índice de campos, inferencia de tipos.
- **`driver/`**: protocolo JSON por línea con registro de comandos
  (`driver/commands/`), sesión con índice de campos perezoso y la capa
  semántica `driver/semantic/` (detección, vistas, cobertura, edición con
  journal reversible y validador).
- **`src-tauri/`**: ventana, diálogo de archivos y el comando genérico
  `driver_call`. La sesión con Ruby vive en el crate `src-tauri/crates/rxdriver`
  (sin dependencia de Tauri, así sus tests corren en cualquier Linux con Ruby).
- **`src/`**: `app/` (cabecera Poké Ball, shell), `features/` (una carpeta por
  pestaña), `ui/` (design system), `i18n/` (es/en), `theme/` (tokens CSS),
  `stores/` (zustand), `api/` (llamadas tipadas al driver).

La app empaqueta su propio Ruby portátil en Windows (el usuario final no
necesita instalar Ruby). En Linux/macOS usa el `ruby` del sistema.

## Desarrollo

### Setup (una sola vez)

1. **Windows (para empaquetar):** instala [7-Zip](https://www.7-zip.org/) y corre
   `powershell -ExecutionPolicy Bypass -File scripts/setup-ruby.ps1`; descarga el
   Ruby portátil en `src-tauri/resources/ruby/` (ignorado por git).
2. `npm install`
3. **Linux** (solo para compilar Tauri): dependencias de WebKitGTK, p. ej.
   `libwebkit2gtk-4.1-dev libgtk-3-dev libsoup-3.0-dev librsvg2-dev`.

`build.rs` copia `edit_rxdata.rb` y `driver/**` a `src-tauri/resources/rxdata/`
en cada build y crea `resources/ruby/` si falta.

### Comandos

```bash
npm run tauri dev        # app de escritorio con recarga en caliente
npm run tauri build      # instalador (Windows)
npm run dev              # solo la UI en el navegador (sin backend)

npm run typecheck        # tsc
npm test                 # vitest: i18n, formateadores, contraste, controles
npm run test:ruby        # minitest: protocolo, capa semántica, edición, bases antiguas
cargo test -p rxdriver   # integración Rust<->Ruby (cd src-tauri)
npm run e2e              # Playwright: UI real contra el driver Ruby real
```

Las pruebas **e2e** levantan Vite y sustituyen el backend de Tauri por un
puente que habla con el driver Ruby real (`e2e/support/bridge.ts`), sobre
copias de `test_saves/` (nunca se modifican). Dejan capturas en
`e2e/screenshots/` (es/en, claro/oscuro). Si tu Chromium no está en la ruta de
Playwright: `PLAYWRIGHT_CHROMIUM_PATH=/ruta/a/chrome npm run e2e`.

### Probar el driver a mano

```bash
ruby driver/rxdata_driver.rb <<'EOF'
{"id":1,"cmd":"open","path":"test_saves/Partida_2.rxdata","autodetect":false}
{"id":2,"cmd":"get_overview"}
{"id":3,"cmd":"apply_ops","ops":[{"op":"set","ref":"trainer","field":"money","value":5000}]}
{"id":4,"cmd":"undo"}
{"id":5,"cmd":"shutdown"}
EOF
```

## Hoja de ruta

- **Iteración 2 — carpeta del juego:** elegir la carpeta del fangame para leer
  `Data/*.dat` / `PBS/` (nombres reales de especies, objetos, movimientos),
  `Graphics/` (sprites e iconos reales, con resolución por convención de
  nombre + coincidencia difusa), selectores con búsqueda y recálculo de stats.
- **Iteración 3:** Pokédex, switches/variables con nombre, clonar/importar/
  exportar Pokémon, backups con restaurar y diff entre dos partidas, búsqueda
  global.
- **Más adelante (opcional):** clasificador ligero de assets (hash perceptual y
  embeddings sobre los propios assets del juego) para casos huérfanos.

## Licencias y recursos

- Logo e ícono de la app: `branding/PESHeX.png` (arte del autor; no cubierto por la licencia MIT, ver `LICENSE`). La Poké Ball del indicador de carga es un SVG propio.
- Fuente de títulos: [Press Start 2P](https://fonts.google.com/specimen/Press+Start+2P) (SIL OFL 1.1, vía `@fontsource`).
- Iconos de interfaz: [Lucide](https://lucide.dev) (ISC).
- No se empaquetan sprites ni artwork oficiales: los gráficos se leerán de la
  carpeta del juego del propio usuario.
