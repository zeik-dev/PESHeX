// Biblioteca «Mis juegos» para las pruebas e2e: reimplementa en Node los comandos `games_*` de src-tauri/src/games.rs (registro,
// Save Scan y cache) con la misma forma de datos y las mismas reglas que `peshex_core::{registry, savescan}`.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

/** Mismo criterio que `fnv1a64` del crate (hash estable de la ruta normalizada, 16 hex). */
export function gameId(root: string): string {
  let h = 0xcbf29ce484222325n;
  for (const b of Buffer.from(norm(root))) {
    h ^= BigInt(b);
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, "0");
}

type Source = "manual" | "appData" | "gameSubdir" | "gameRoot";
interface SaveFile { name: string; path: string; size: number; modified: number | null }
interface ScanResult { dir: string | null; source: Source | null; files: SaveFile[]; candidates: { dir: string; source: Source; count: number }[] }
export interface GameEntry {
  id: string; root: string; name: string; title: string | null; addedAt: number; lastOpenedAt: number | null;
  saveDirs: string[]; lastScan: { dir: string | null; source: Source | null; count: number; at: number } | null;
  indexedAt: number | null; fingerprint: string | null;
}

const ci = (dir: string, name: string): string | null => {
  if (!fs.existsSync(dir)) return null;
  const f = fs.readdirSync(dir).find((c) => c.toLowerCase() === name.toLowerCase());
  return f ? path.join(dir, f) : null;
};

const looksLikeGame = (dir: string) => {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return false;
  const data = ci(dir, "Data");
  return !!ci(dir, "Game.ini") || !!(data && ci(data, "Scripts.rxdata")) || (!!data && !!ci(dir, "Graphics"));
};

const isSave = (file: string) => {
  const name = path.basename(file).toLowerCase();
  if (!name.endsWith(".rxdata") || name.includes(".bak")) return false;
  const st = fs.statSync(file, { throwIfNoEntry: false });
  if (!st?.isFile() || st.size < 64) return false;
  const fd = fs.openSync(file, "r");
  try {
    const head = Buffer.alloc(2);
    fs.readSync(fd, head, 0, 2, 0);
    return head[0] === 0x04 && head[1] === 0x08;
  } finally {
    fs.closeSync(fd);
  }
};

const listSaves = (dir: string): SaveFile[] => {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && isSave(path.join(dir, e.name)))
    .map((e) => {
      const p = path.join(dir, e.name);
      const st = fs.statSync(p);
      return { name: e.name, path: p, size: st.size, modified: Math.floor(st.mtimeMs / 1000) };
    })
    .sort((a, b) => (b.modified ?? 0) - (a.modified ?? 0) || a.name.localeCompare(b.name));
};

const SKIP = ["data", "graphics", "audio", "pbs", "fonts", "movies", "plugins", "mkxp", "ruby", "system"];
const HINTS = ["save", "partida", "guardad", "slot"];

function gameSubdirs(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).filter((x) => x.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
      const n = e.name.toLowerCase();
      if (SKIP.includes(n)) continue;
      const full = path.join(dir, e.name);
      if (HINTS.some((h) => n.includes(h))) out.push(full);
      if (depth < 2) walk(full, depth + 1);
    }
  };
  walk(root, 1);
  return out;
}

function gameTitle(root: string): string | null {
  const ini = ci(root, "Game.ini");
  if (!ini) return null;
  for (const line of fs.readFileSync(ini, "utf8").split(/\r?\n/)) {
    const m = /^\s*title\s*=\s*(.+?)\s*$/i.exec(line.replace(/^﻿/, ""));
    if (m) return m[1];
  }
  return null;
}

export class GamesMock {
  games: GameEntry[] = [];
  /** Carpetas donde buscar `<nombre del juego>` (en la app: %APPDATA%, %LOCALAPPDATA%, Saved Games, Documentos). */
  appDataDirs: string[] = [];
  readonly cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), "peshex-e2e-cache-"));
  private clock = 1_700_000_000;

  private now() {
    return (this.clock += 1);
  }

  dispose() {
    fs.rmSync(this.cacheRoot, { recursive: true, force: true });
  }

  cacheDir(root: string) {
    return path.join(this.cacheRoot, gameId(root));
  }

  private get(id: string): GameEntry {
    const g = this.games.find((x) => x.id === id);
    if (!g) throw { kind: "GameNotFound", message: `no hay ningún juego registrado con el id ${id}` };
    return g;
  }

  list() {
    return [...this.games].sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0) || b.addedAt - a.addedAt || a.name.localeCompare(b.name));
  }

  add(root: string) {
    if (!looksLikeGame(root)) throw { kind: "NotAGameFolder", message: `la carpeta no parece un juego de Pokémon Essentials: ${root}` };
    const id = gameId(root);
    let game = this.games.find((g) => g.id === id);
    const created = !game;
    if (!game) {
      const title = gameTitle(root);
      game = { id, root, name: title || path.basename(root), title, addedAt: this.now(), lastOpenedAt: null, saveDirs: [], lastScan: null, indexedAt: null, fingerprint: null };
      this.games.push(game);
    }
    const scan = this.scan(game);
    return { game, created, scan };
  }

  remove(id: string) {
    this.games = this.games.filter((g) => g.id !== id);
  }

  rename(id: string, name: string) {
    if (name.trim()) this.get(id).name = name.trim();
  }

  touch(id: string) {
    this.get(id).lastOpenedAt = this.now();
  }

  scan(g: GameEntry): ScanResult {
    const names = [g.title, g.title?.replace(/[\\/:*?"<>|]/g, "").trim(), path.basename(g.root)].filter((x): x is string => !!x);
    const candidates: [string, Source][] = [];
    const seen = new Set<string>();
    const push = (p: string, s: Source) => {
      if (!seen.has(norm(p))) {
        seen.add(norm(p));
        candidates.push([p, s]);
      }
    };
    g.saveDirs.forEach((d) => push(d, "manual"));
    for (const base of this.appDataDirs) for (const n of names) push(path.join(base, n), "appData");
    gameSubdirs(g.root).forEach((d) => push(d, "gameSubdir"));
    push(g.root, "gameRoot");
    const result: ScanResult = { dir: null, source: null, files: [], candidates: [] };
    for (const [dir, source] of candidates) {
      if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;
      const files = listSaves(dir);
      result.candidates.push({ dir, source, count: files.length });
      if (!result.dir && files.length) Object.assign(result, { dir, source, files });
    }
    g.lastScan = { dir: result.dir, source: result.source, count: result.files.length, at: this.now() };
    return result;
  }

  scanById(id: string) {
    return this.scan(this.get(id));
  }

  addSaveDir(id: string, dir: string) {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw { kind: "InvalidPath", message: `no existe la carpeta '${dir}'` };
    const g = this.get(id);
    if (!g.saveDirs.some((d) => norm(d) === norm(dir))) g.saveDirs.push(dir);
    return this.scan(g);
  }

  removeSaveDir(id: string, dir: string) {
    const g = this.get(id);
    g.saveDirs = g.saveDirs.filter((d) => norm(d) !== norm(dir));
    return this.scan(g);
  }

  findForSave(file: string): GameEntry | null {
    const parent = norm(path.dirname(file));
    let best: [GameEntry, number] | null = null;
    for (const g of this.games) {
      const inSaveDir = [...g.saveDirs, g.lastScan?.dir].some((d) => d && norm(d) === parent);
      const root = norm(g.root);
      const inRoot = norm(file).startsWith(root + "/");
      const score = inSaveDir ? 1_000_000 + root.length : inRoot ? root.length : -1;
      if (score >= 0 && (!best || score > best[1])) best = [g, score];
    }
    return best?.[0] ?? null;
  }

  seed(roots: string[]) {
    let n = 0;
    for (const r of roots) if (looksLikeGame(r) && !this.games.some((g) => g.id === gameId(r))) (this.add(r), (n += 1));
    return n;
  }
}
