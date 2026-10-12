// Carpeta de juego SINTETICA para las pruebas e2e: los datos (`Data/*.dat`) los
// genera el fixture Ruby (derivados del propio save) y los graficos son PNG
// inventados de colores. Nunca se usan sprites ni datos oficiales.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

// ── Codificador PNG minimo (RGBA 8 bits, sin filtros) ────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

export type Pixel = [number, number, number, number];

export function encodePng(w: number, h: number, f: (x: number, y: number) => Pixel): Buffer {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const p = f(x, y);
      raw.set(p, y * (w * 4 + 1) + 1 + x * 4);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function hue(s: string): number {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

function hsl(h: number, s: number, l: number): [number, number, number] {
  const a = s * Math.min(l, 1 - l);
  const k = (n: number) => (n + h / 30) % 12;
  const f = (n: number) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
  return [f(0), f(8), f(4)];
}

/** Tira de 2 cuadros de 64x64: un disco del color de la especie (2.º cuadro desplazado). */
function iconStrip(name: string): Buffer {
  const [r, g, b] = hsl(hue(name), 0.65, 0.5);
  return encodePng(128, 64, (x, y) => {
    const frame = x < 64 ? 0 : 1;
    const cx = (x % 64) - 32;
    const cy = y - 32 - (frame ? 3 : 0);
    return cx * cx + cy * cy < 24 * 24 ? [r, g, b, 255] : [0, 0, 0, 0];
  });
}

function solid(w: number, h: number, name: string, lum = 0.55): Buffer {
  const [r, g, b] = hsl(hue(name), 0.6, lum);
  return encodePng(w, h, () => [r, g, b, 255]);
}

function boxBackground(n: number): Buffer {
  const [r, g, b] = hsl((n * 47) % 360, 0.45, 0.78);
  return encodePng(324, 296, (x, y) => {
    const border = x < 4 || y < 4 || x > 319 || y > 291;
    const inGrid = x >= 10 && x < 298 && y >= 30 && y < 270 && (Math.floor((x - 10) / 48) + Math.floor((y - 30) / 48)) % 2 === 0;
    if (border) return [60, 60, 60, 255];
    return inGrid ? [Math.min(255, r + 18), Math.min(255, g + 18), Math.min(255, b + 18), 255] : [r, g, b, 255];
  });
}

export interface FakeGame {
  root: string;
  manifest: { species: [string, number][]; items: string[]; balls: string[] };
}

/** Crea la carpeta de juego sintetica en `dir` a partir de `savePath`. */
export interface FakeGameOptions {
  /** Archivo (sin extension) con el que se guarda el icono de una especie en lugar de su nombre habitual. */
  iconAliases?: Record<string, string>;
  /** Tambien genera `Graphics/Pokemon/Front/<especie>.png` (referencia para las sugerencias por parecido). */
  fronts?: boolean;
}

/** Disco grande del color de la especie (sprite de combate inventado). */
function frontSprite(name: string): Buffer {
  const [r, g, b] = hsl(hue(name), 0.65, 0.5);
  return encodePng(96, 96, (x, y) => {
    const cx = x - 48;
    const cy = y - 48;
    return cx * cx + cy * cy < 36 * 36 ? [r, g, b, 255] : [0, 0, 0, 0];
  });
}

export function buildFakeGame(
  repoRoot: string, dir: string, savePath: string, renames: Record<string, string> = {}, opts: FakeGameOptions = {},
): FakeGame {
  fs.mkdirSync(dir, { recursive: true });
  const args = [path.join(repoRoot, "test", "fixtures", "build_game_cli.rb"), dir, savePath, ...Object.entries(renames).map(([k, v]) => `${k}=${v}`)];
  const out = execFileSync("ruby", ["-E", "UTF-8", ...args], { env: { ...process.env, RUBYOPT: "", LC_ALL: "C.UTF-8" } }).toString();
  const manifest = JSON.parse(out.trim().split("\n").pop()!) as FakeGame["manifest"];

  const write = (rel: string, data: Buffer) => {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, data);
  };
  for (const [sp, form] of manifest.species) {
    const base = form > 0 ? `${sp}_${form}` : sp;
    write(`Graphics/Pokemon/Icons/${opts.iconAliases?.[base] ?? base}.png`, iconStrip(base));
    if (opts.fronts) write(`Graphics/Pokemon/Front/${base}.png`, frontSprite(base));
    write(`Graphics/Pokemon/Icons shiny/${base}.png`, iconStrip(`${base}-shiny`));
  }
  write("Graphics/Pokemon/Icons/000.png", iconStrip("000"));
  for (const id of [...manifest.items, ...manifest.balls]) write(`Graphics/Items/${id}.png`, solid(48, 48, id));
  write("Graphics/Items/000.png", solid(48, 48, "000", 0.3));
  for (const id of manifest.balls) write(`Graphics/UI/Summary/icon_ball_${id}.png`, solid(24, 24, id, 0.4));
  write("Graphics/UI/Party/icon_item.png", solid(16, 16, "held", 0.2));
  for (let n = 0; n < 6; n++) write(`Graphics/UI/Storage/box_${n}.png`, boxBackground(n));
  // Algo irrelevante que el escaneo debe ignorar.
  write("Graphics/Characters/hero.png", solid(32, 32, "hero"));
  return { root: dir, manifest };
}
