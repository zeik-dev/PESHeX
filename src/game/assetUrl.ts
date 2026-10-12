import { convertFileSrc } from "@tauri-apps/api/core";
import { gameApi } from "../api/game";

// URL de una imagen de la carpeta del juego. Camino principal: el asset protocol
// de Tauri (convertFileSrc), que el navegador cachea y carga sin pasar por JS.
// Si falla (scope, CSP, un 403 raro en alguna maquina) se cae a pedir los bytes a
// Rust (`read_game_file`) y se sirven como Blob URL; tras el primer fallo se usa
// siempre el plan B para no reintentar un camino roto en cada imagen.

const MAX_BLOBS = 800;
const blobs = new Map<string, string>(); // ruta -> blob URL (orden de insercion = LRU)
const pending = new Map<string, Promise<string>>();
let protocolBroken = false;

function joinPath(root: string, rel: string): string {
  const sep = root.includes("\\") && !root.includes("/") ? "\\" : "/";
  return `${root.replace(/[\\/]+$/, "")}${sep}${rel.split("/").join(sep)}`;
}

export function directUrl(root: string, rel: string): string {
  return convertFileSrc(joinPath(root, rel));
}

export function isProtocolBroken(): boolean {
  return protocolBroken;
}

export function markProtocolBroken() {
  protocolBroken = true;
}

function mimeOf(rel: string): string {
  const ext = rel.slice(rel.lastIndexOf(".") + 1).toLowerCase();
  return ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "gif" ? "image/gif" : ext === "bmp" ? "image/bmp" : "image/png";
}

/** Blob URL de una imagen (con cache LRU). */
export function bytesUrl(rel: string): Promise<string> {
  const hit = blobs.get(rel);
  if (hit) {
    blobs.delete(rel);
    blobs.set(rel, hit);
    return Promise.resolve(hit);
  }
  let p = pending.get(rel);
  if (!p) {
    p = gameApi
      .readFile(rel)
      .then((bytes) => {
        const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mimeOf(rel) }));
        blobs.set(rel, url);
        while (blobs.size > MAX_BLOBS) {
          const oldest = blobs.keys().next().value as string;
          URL.revokeObjectURL(blobs.get(oldest)!);
          blobs.delete(oldest);
        }
        return url;
      })
      .finally(() => pending.delete(rel));
    pending.set(rel, p);
  }
  return p;
}

/** Libera todo lo cacheado (al cambiar de carpeta de juego). */
export function clearAssetCache() {
  for (const url of blobs.values()) URL.revokeObjectURL(url);
  blobs.clear();
  pending.clear();
  protocolBroken = false;
}
