// Puente de pruebas e2e: sustituye al backend Tauri por el driver Ruby REAL.
// El navegador (Chromium + Vite) llama a `window.__TAURI_INTERNALS__.invoke`,
// que reenvia aqui; este modulo habla el protocolo JSON-por-linea con
// `ruby driver/rxdata_driver.rb`, igual que el crate Rust `rxdriver`.

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import { createInterface } from "node:readline";
import path from "node:path";

type Json = Record<string, unknown>;

export class DriverBridge {
  private proc: ChildProcessWithoutNullStreams;
  private pending: ((line: string) => void)[] = [];
  private buffer: string[] = [];
  private nextId = 1;
  dialogPath = "";
  /** Lo que devuelve el selector de carpetas (`directory: true`). */
  dialogDir = "";
  locale = "es-ES";
  /** Retraso artificial (ms) de cada `game_link_step`: deja ver la barra de progreso en las pruebas. */
  stepDelayMs = 0;
  /** Retraso artificial (ms) de `get_species` y `get_species_extras`: emula la latencia de IPC y de Ruby de la app real. */
  callDelayMs = 0;
  /** Comandos que fallan a propósito (prueba de errores): `cmd` → error lógico del driver, `times` veces (o siempre). */
  private failing = new Map<string, { kind: string; message: string; times: number }>();
  /** Como `AppState.driver` en Rust: tras un error fatal (p. ej. una respuesta con otro `id`) la sesión se da de baja. */
  private dead = false;
  /** Raiz de juego vinculada (la fija scan_game_folder, como AppState.game_root en Rust). */
  private gameRoot: string | null = null;
  /** Mapas manuales por raiz (en Rust: directorio de datos de la app). */
  private assetMaps = new Map<string, unknown>();
  /** Factores que la app pidio con `getCurrentWebview().setZoom(...)` (el zoom nativo del WebView). */
  zoomCalls: number[] = [];
  /** Se llama con cada zoom nativo pedido (lo usa `ZoomEmulator` para reproducir el efecto del zoom del WebView). */
  onZoom?: (factor: number) => void;

  constructor(repoRoot: string) {
    this.proc = spawn("ruby", ["-E", "UTF-8", path.join(repoRoot, "driver", "rxdata_driver.rb")], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, RUBYOPT: "", LC_ALL: "C.UTF-8" },
    });
    const rl = createInterface({ input: this.proc.stdout });
    rl.on("line", (line) => {
      const waiter = this.pending.shift();
      if (waiter) waiter(line);
      else this.buffer.push(line);
    });
    this.proc.stderr.on("data", (d) => process.stderr.write(`[driver] ${d}`));
  }

  /** Hace que `cmd` devuelva un error lógico `times` veces (por defecto, siempre hasta `clearFailures`). */
  failCommand(cmd: string, message = "fallo simulado", kind = "SimulatedError", times = Number.POSITIVE_INFINITY) {
    this.failing.set(cmd, { kind, message, times });
  }

  clearFailures() {
    this.failing.clear();
  }

  private send(cmd: string, params: Json = {}): Promise<Json> {
    const id = this.nextId++;
    return new Promise((resolve) => {
      // Igual que el crate `rxdriver`: la respuesta debe traer el `id` de la petición; si no, se marca como fatal.
      const onLine = (line: string) => {
        const res = JSON.parse(line) as Json;
        if (res.id !== id) {
          resolve({ ok: false, fatal: true, error: { type: "Fatal", message: `el proceso Ruby se desincronizó (esperaba id ${id}, recibió ${JSON.stringify(res.id)})` } });
        } else resolve(res);
      };
      const queued = this.buffer.shift();
      if (queued !== undefined) onLine(queued);
      else this.pending.push(onLine);
      this.proc.stdin.write(JSON.stringify({ ...params, id, cmd }) + "\n");
    });
  }

  /** Atiende un `invoke` de Tauri. Devuelve { value } o { error } (el init
   *  script del navegador lo convierte en resolve/reject). */
  async handle(cmd: string, args: Json = {}): Promise<{ value?: unknown; error?: unknown }> {
    switch (cmd) {
      case "open_save": {
        await this.send("close");
        this.dead = false;
        const res = await this.send("open", { path: args.path, autodetect: false });
        return this.wrap(res);
      }
      case "close_save":
        await this.send("close");
        return { value: null };
      case "driver_call": {
        if (this.stepDelayMs && args.cmd === "game_link_step") await new Promise((r) => setTimeout(r, this.stepDelayMs));
        if (this.callDelayMs && /^get_species/.test(String(args.cmd))) await new Promise((r) => setTimeout(r, this.callDelayMs));
        const fail = this.failing.get(String(args.cmd));
        if (fail && fail.times > 0) {
          fail.times -= 1;
          return { error: { kind: fail.kind, message: fail.message, params: null, fatal: false } };
        }
        if (this.dead) return { error: { kind: "NoSessionOpen", message: "No hay ningun archivo abierto. Abre un archivo primero.", params: null, fatal: false } };
        const res = await this.send(String(args.cmd), (args.params as Json) ?? {});
        if (res.fatal) this.dead = true;
        return this.wrap(res);
      }
      case "plugin:dialog|open": {
        const opts = (args.options ?? {}) as Json;
        return { value: opts.directory ? this.dialogDir : this.dialogPath };
      }
      // ── Comandos de game.rs reimplementados en Node (misma forma de datos) ──
      case "scan_game_folder": {
        const root = String(args.root);
        if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
          return { error: { kind: "GameFolderInvalid", message: `no existe la carpeta '${root}'` } };
        }
        this.gameRoot = root;
        return { value: scanGraphics(root) };
      }
      case "forget_game_folder":
        this.gameRoot = null;
        return { value: null };
      case "read_game_file": {
        if (!this.gameRoot) return { error: { kind: "NoGameFolder", message: "no hay una carpeta de juego vinculada" } };
        const rel = String(args.rel);
        const full = path.resolve(this.gameRoot, rel);
        const inside = full.startsWith(path.resolve(this.gameRoot) + path.sep);
        if (!inside || !/\.(png|jpe?g|gif|bmp)$/i.test(rel) || !fs.existsSync(full)) {
          return { error: { kind: "InvalidPath", message: "ruta no permitida" } };
        }
        return { value: Array.from(fs.readFileSync(full)) };
      }
      case "assetmap_load":
        return { value: this.assetMaps.get(String(args.root)) ?? null };
      case "assetmap_save":
        this.assetMaps.set(String(args.root), args.map);
        return { value: null };
      case "plugin:event|listen":
        return { value: 1 };
      case "plugin:webview|set_webview_zoom":
        this.zoomCalls.push(Number(args.value));
        this.onZoom?.(Number(args.value));
        return { value: null };
      default:
        return { value: null };
    }
  }

  private wrap(res: Json): { value?: unknown; error?: unknown } {
    if (res.ok) return { value: res };
    const e = (res.error ?? {}) as Json;
    return { error: { kind: e.type ?? "DriverError", message: e.message ?? "", params: e.params ?? null, fatal: res.fatal === true } };
  }

  async dispose() {
    try {
      await this.send("shutdown");
    } catch {
      /* ya cerrado */
    }
    this.proc.kill();
  }
}

const RELEVANT = ["pokemon", "items", "ui", "pictures", "icons", "battlers", "trainers"];
/** Como en Rust: de `Characters` solo se indexan las imagenes del entrenador (`trainer004.png`, `trchar004.png`). */
const FILTERED: Record<string, string[]> = { characters: ["trainer", "trchar"] };

function childCi(dir: string, name: string): string | null {
  if (!fs.existsSync(dir)) return null;
  const found = fs.readdirSync(dir).find((c) => c.toLowerCase() === name.toLowerCase());
  return found ? path.join(dir, found) : null;
}

function pngSize(file: string): [number, number] {
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.alloc(24);
    fs.readSync(fd, buf, 0, 24, 0);
    if (buf.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") return [0, 0];
    return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
  } finally {
    fs.closeSync(fd);
  }
}

/** Equivale a `scan_graphics` de src-tauri/src/game.rs. */
function scanGraphics(root: string) {
  const graphics = childCi(root, "Graphics");
  const files: [string, number, number][] = [];
  const walk = (dir: string, prefixes?: string[]) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, prefixes);
      else if (e.isFile() && /\.(png|jpe?g|gif|bmp)$/i.test(e.name) && (!prefixes || prefixes.some((p) => e.name.toLowerCase().startsWith(p)))) {
        const [w, h] = pngSize(full);
        files.push([path.relative(root, full).split(path.sep).join("/"), w, h]);
      }
    }
  };
  if (graphics) {
    for (const name of RELEVANT) { const sub = childCi(graphics, name); if (sub) walk(sub); }
    for (const [name, prefixes] of Object.entries(FILTERED)) { const sub = childCi(graphics, name); if (sub) walk(sub, prefixes); }
  }
  files.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return { root, graphics, files, truncated: false };
}

/** Script que se inyecta en la pagina para simular el runtime de Tauri. */
export const TAURI_MOCK = `
  (() => {
    const callbacks = {};
    window.__TAURI_INTERNALS__ = {
      invoke: async (cmd, args) => {
        const r = await window.__pwInvoke(cmd, args ?? {});
        if (r && r.error) throw r.error;
        return r ? r.value : null;
      },
      transformCallback: (cb) => { const id = Math.floor(Math.random() * 1e9); callbacks[id] = cb; return id; },
      // Como el asset protocol: una URL que el servidor de pruebas (page.route) resuelve a disco.
      convertFileSrc: (p) => '/__game/' + btoa(unescape(encodeURIComponent(p))).replace(/[+]/g, '-').replace(/[/]/g, '_').replace(/=+$/, ''),
      metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } },
    };
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
  })();
`;
