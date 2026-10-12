// Escritor de .zip minimo y determinista (sin dependencias): deflate + CRC32, nombres en UTF-8,
// orden y fecha fijos para que dos empaquetados del mismo contenido den el mismo archivo.
// No usa ZIP64 (los archivos y el zip son mucho menores de 4 GB).

import { deflateRawSync } from "node:zlib";

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Fecha/hora MS-DOS (2 bytes cada una) de un Date en UTC. */
export function dosDateTime(date) {
  const y = Math.max(date.getUTCFullYear(), 1980);
  const time = (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | (date.getUTCSeconds() >> 1);
  const day = ((y - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate();
  return { time, date: day };
}

const u16 = (n) => {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n);
  return b;
};
const u32 = (n) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0);
  return b;
};

/**
 * @param {{ name: string, data: Buffer }[]} entries  `name` con '/' como separador, sin '/' inicial
 * @param {{ mtime?: Date }} [opts]
 * @returns {Buffer}
 */
export function createZip(entries, opts = {}) {
  const { time, date } = dosDateTime(opts.mtime ?? new Date(Date.UTC(2026, 0, 1)));
  const sorted = [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const parts = [];
  const central = [];
  let offset = 0;

  for (const e of sorted) {
    if (e.name.startsWith("/") || e.name.includes("\\") || e.name.split("/").includes("..")) {
      throw new Error(`nombre de entrada no permitido: ${e.name}`);
    }
    const name = Buffer.from(e.name, "utf8");
    const crc = crc32(e.data);
    let method = 8;
    let body = deflateRawSync(e.data, { level: 9 });
    if (body.length >= e.data.length) {
      method = 0; // guardado tal cual si deflate no ayuda
      body = e.data;
    }
    const flags = 0x0800; // nombres UTF-8
    const header = Buffer.concat([
      u32(0x04034b50), u16(20), u16(flags), u16(method), u16(time), u16(date),
      u32(crc), u32(body.length), u32(e.data.length), u16(name.length), u16(0), name,
    ]);
    parts.push(header, body);
    central.push(Buffer.concat([
      u32(0x02014b50), u16(0x031e), u16(20), u16(flags), u16(method), u16(time), u16(date),
      u32(crc), u32(body.length), u32(e.data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0),
      u32(0), u32(offset), name,
    ]));
    offset += header.length + body.length;
  }

  const centralBuf = Buffer.concat(central);
  const end = Buffer.concat([
    u32(0x06054b50), u16(0), u16(0), u16(sorted.length), u16(sorted.length),
    u32(centralBuf.length), u32(offset), u16(0),
  ]);
  return Buffer.concat([...parts, centralBuf, end]);
}
