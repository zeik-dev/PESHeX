// Puente de pruebas e2e: sustituye al backend Tauri por el driver Ruby REAL.
// El navegador (Chromium + Vite) llama a `window.__TAURI_INTERNALS__.invoke`,
// que reenvia aqui; este modulo habla el protocolo JSON-por-linea con
// `ruby driver/rxdata_driver.rb`, igual que el crate Rust `rxdriver`.

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import { createInterface } from "node:readline";
import path from "node:path";
import { GamesMock } from "./games";

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
  /** Biblioteca «Mis juegos» (en Rust: games.json + Save Scan). */
  games = new GamesMock();
  /** Emite un evento de Tauri hacia la página (lo conecta `setup` con `window.__pwEmit`). */
  emit?: (event: string, payload: unknown) => Promise<void>;
  /** Actualizador simulado (los comandos `update_*` de updater.rs): la prueba dicta que responde y emite `updater://event`. */
  updater: {
    available: boolean;
    check: unknown;
    lastResult: unknown;
    /** Ordenes recibidas, en orden: `check`, `start`, `pause`, `resume`, `cancel`, `apply`. */
    calls: string[];
    /** Rutas que la app pidió mostrar en el explorador (`revealItemInDir`), p. ej. el registro `updater.log`. */
    revealed: string[];
    started: { version?: string } | null;
  } = { available: false, check: { status: "upToDate", current: "1.0.0", latest: "1.0.0" }, lastResult: null, calls: [], revealed: [], started: null };
  /** Juegos que se estan precargando (como `PRELOADING` en Rust). */
  private preloading = new Set<string>();
  /** El driver ya se cerró (fin de la prueba): los comandos que lleguen tarde responden con un error en vez de escribir en una tubería rota. */
  private disposed = false;

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
    // Una página que sigue pidiendo comandos cuando la prueba ya cerró el driver no debe tumbar la prueba SIGUIENTE (EPIPE).
    this.proc.stdin.on("error", () => undefined);
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
    if (this.disposed) return Promise.resolve({ ok: false, fatal: true, error: { type: "Fatal", message: "el driver de prueba ya está cerrado" } });
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
      case "reload_save": {
        // Rust: vuelve a leer el save del disco sin cerrar el driver (conserva la carpeta del juego y el modo)
        if (this.dead) return { error: { kind: "NoSessionOpen", message: "No hay ningun archivo abierto. Abre un archivo primero.", params: null, fatal: false } };
        return this.wrap(await this.send("reload", {}));
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
        return { value: Number(args.handler ?? 1) };
      case "plugin:event|unlisten":
        return { value: null };
      // ── Biblioteca «Mis juegos» (games.rs) ──
      case "games_list":
      case "games_add":
      case "games_remove":
      case "games_rename":
      case "games_touch":
      case "games_scan_saves":
      case "games_add_save_dir":
      case "games_remove_save_dir":
      case "games_find_for_save":
      case "games_seed":
      case "games_cache_dir":
      case "games_preloading":
        return this.gamesCommand(cmd, args);
      case "games_preload":
        return this.gamesPreload(String(args.id));
      // ── Actualizador (updater.rs) ──
      case "update_available":
        return { value: this.updater.available };
      case "update_check":
        this.updater.calls.push("check");
        return { value: this.updater.check };
      case "update_start":
        this.updater.calls.push("start");
        this.updater.started = (args.release ?? null) as { version?: string } | null;
        return { value: null };
      case "update_control":
        this.updater.calls.push(String(args.action));
        return { value: null };
      case "update_apply":
        this.updater.calls.push("apply");
        return { value: null };
      case "update_log_path":
        return { value: "C:\\Users\\Alex\\AppData\\Roaming\\com.zeik.peshex\\updates\\updater.log" };
      case "plugin:opener|reveal_item_in_dir":
        this.updater.revealed.push(...((args.paths as string[] | undefined) ?? []).map(String));
        return { value: null };
      case "update_last_result": {
        const r = this.updater.lastResult;
        this.updater.lastResult = null;
        return { value: r };
      }
      case "plugin:webview|set_webview_zoom":
        this.zoomCalls.push(Number(args.value));
        this.onZoom?.(Number(args.value));
        return { value: null };
      default:
        return { value: null };
    }
  }

  private gamesCommand(cmd: string, args: Json): { value?: unknown; error?: unknown } {
    try {
      const g = this.games;
      switch (cmd) {
        case "games_list": return { value: g.list() };
        case "games_add": return { value: g.add(String(args.root)) };
        case "games_remove": g.remove(String(args.id)); return { value: null };
        case "games_rename": g.rename(String(args.id), String(args.name)); return { value: null };
        case "games_touch": g.touch(String(args.id)); return { value: null };
        case "games_scan_saves": return { value: g.scanById(String(args.id)) };
        case "games_add_save_dir": return { value: g.addSaveDir(String(args.id), String(args.dir)) };
        case "games_remove_save_dir": return { value: g.removeSaveDir(String(args.id), String(args.dir)) };
        case "games_find_for_save": return { value: g.findForSave(String(args.path)) };
        case "games_seed": return { value: g.seed((args.roots as string[]) ?? []) };
        case "games_cache_dir": return { value: g.cacheDir(String(args.root)) };
        default: return { value: [...this.preloading] };
      }
    } catch (e) {
      return { error: { params: null, fatal: false, ...(e as object) } };
    }
  }

  /** Como `games_preload` de Rust: recorre los pasos del driver (sin partida abierta) y avisa con `games://preload`. */
  private async gamesPreload(id: string): Promise<{ value?: unknown; error?: unknown }> {
    const game = this.games.games.find((x) => x.id === id);
    if (!game) return { error: { kind: "GameNotFound", message: `no hay ningún juego registrado con el id ${id}`, params: null } };
    if (this.preloading.has(id)) return { error: { kind: "Busy", message: "este juego ya se está precargando", params: null } };
    this.preloading.add(id);
    try {
      const begin = await this.send("game_preload_begin", { path: game.root, cacheDir: this.games.cacheDir(game.root) });
      if (!begin.ok) return this.wrap(begin);
      const steps = (begin.steps as string[]) ?? [];
      const total = steps.length + 1;
      for (const [i, step] of steps.entries()) {
        await this.emit?.("games://preload", { id, step, done: i, total });
        if (this.stepDelayMs) await new Promise((r) => setTimeout(r, this.stepDelayMs));
        const r = await this.send("game_preload_step", { step });
        if (!r.ok) return this.wrap(r);
      }
      await this.emit?.("games://preload", { id, step: "graphics", done: steps.length, total });
      const fin = await this.send("game_preload_finish");
      if (!fin.ok) return this.wrap(fin);
      game.indexedAt = Math.floor(Date.now() / 1000);
      game.fingerprint = (fin.fingerprint as string) ?? null;
      await this.emit?.("games://preload", { id, done: true, total: 1 });
      return { value: { id, cached: fin.cached ?? false, state: fin.state ?? null } };
    } finally {
      this.preloading.delete(id);
    }
  }

  private wrap(res: Json): { value?: unknown; error?: unknown } {
    if (res.ok) return { value: res };
    const e = (res.error ?? {}) as Json;
    return { error: { kind: e.type ?? "DriverError", message: e.message ?? "", params: e.params ?? null, fatal: res.fatal === true } };
  }

  async dispose() {
    this.games.dispose();
    try {
      await this.send("shutdown");
    } catch {
      /* ya cerrado */
    }
    this.disposed = true;
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
    // Eventos de Tauri: la prueba los emite desde Node con window.__pwEmit(evento, carga).
    const listeners = {};
    const inv = window.__TAURI_INTERNALS__.invoke;
    window.__TAURI_INTERNALS__.invoke = async (cmd, args) => {
      if (cmd === 'plugin:event|listen') (listeners[args.event] ??= []).push(args.handler);
      return inv(cmd, args);
    };
    window.__pwEmit = (event, payload) => {
      for (const id of listeners[event] ?? []) callbacks[id]?.({ event, id, payload });
    };
  })();
`;
