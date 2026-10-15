#!/usr/bin/env node
// Arma el zip del release: todo lo necesario para ejecutar PESHeX en Windows, sin instalador.
//
//   node scripts/package-release.mjs --exe <PESHeX.exe> --updater <PESHeX-Updater.exe> --version 1.0.0 [--out release-out] [--ruby <dir>] [--rxdata <dir>]
//
// Contenido (carpeta raiz PESHeX-<version>-windows-x64/):
//   PESHeX.exe  PESHeX-Updater.exe  ruby/  rxdata/  LEEME.txt  LICENSE  THIRD-PARTY-NOTICES.txt  CONTENIDO.sha256
// El actualizador va SIEMPRE: sin el, la app de esta version no podria actualizarse sola a la siguiente.
// Ademas escribe SHA256SUMS.txt (con el hash del zip) junto al zip.

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createZip } from "./lib/zip.mjs";
import { REQUIRED_RUBY_FILES, shouldKeep } from "./lib/trim.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

/** Recorre `dir` y devuelve [rutaRelativaConSlash, rutaAbsoluta] ordenadas, saltando lo que `keep` rechace. */
export function walk(dir, keep = () => true, prefix = "") {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    const abs = path.join(dir, e.name);
    if (e.isSymbolicLink()) continue; // nunca se siguen enlaces
    if (e.isDirectory()) out.push(...walk(abs, keep, rel));
    else if (e.isFile() && keep(rel)) out.push([rel, abs]);
  }
  return out;
}

export function leemeFor(version) {
  const text = fs.readFileSync(path.join(ROOT, "release", "LEEME.txt"), "utf8").replace(/\r\n/g, "\n");
  return text.replaceAll("{{VERSION}}", version).replace(/\n/g, "\r\n"); // Bloc de notas clasico
}

/**
 * @param {{ exe: string, updater: string, version: string, out: string, ruby?: string, rxdata?: string }} o
 * @returns {{ zipPath: string, sumsPath: string, zipSha256: string, files: number }}
 */
export function packageRelease(o) {
  const ruby = o.ruby ?? path.join(ROOT, "src-tauri", "resources", "ruby");
  const rxdata = o.rxdata ?? path.join(ROOT, "src-tauri", "resources", "rxdata");
  const top = `PESHeX-${o.version}-windows-x64`;

  for (const [what, p] of [["el ejecutable", o.exe], ["el actualizador (PESHeX-Updater.exe)", o.updater], ["el Ruby portatil", ruby], ["el driver (rxdata)", rxdata]]) {
    if (!fs.existsSync(p)) throw new Error(`falta ${what}: ${p}`);
  }
  const rubyFiles = walk(ruby, shouldKeep);
  for (const req of REQUIRED_RUBY_FILES) {
    if (!rubyFiles.some(([rel]) => rel === req || rel.startsWith(`${req}/`))) {
      throw new Error(`el Ruby portatil no tiene ${req}: ¿se corrio scripts/setup-ruby.ps1?`);
    }
  }
  if (!fs.existsSync(path.join(rxdata, "driver", "rxdata_driver.rb"))) throw new Error("rxdata no contiene driver/rxdata_driver.rb");

  /** @type {{name: string, data: Buffer}[]} */
  const entries = [];
  const add = (name, data) => entries.push({ name: `${top}/${name}`, data });
  add("PESHeX.exe", fs.readFileSync(o.exe));
  add("PESHeX-Updater.exe", fs.readFileSync(o.updater));
  for (const [rel, abs] of rubyFiles) {
    if (rel === ".ruby-version-installed") continue; // marcador interno del script de instalacion
    add(`ruby/${rel}`, fs.readFileSync(abs));
  }
  for (const [rel, abs] of walk(rxdata)) add(`rxdata/${rel}`, fs.readFileSync(abs));
  add("LEEME.txt", Buffer.from(leemeFor(o.version), "utf8"));
  add("LICENSE", fs.readFileSync(path.join(ROOT, "LICENSE")));
  add("THIRD-PARTY-NOTICES.txt", fs.readFileSync(path.join(ROOT, "THIRD-PARTY-NOTICES.txt")));

  // Hash de cada archivo (para comprobar la extraccion con smoke-release.ps1 o a mano).
  const names = entries.map((e) => e.name.slice(top.length + 1)).sort();
  const byName = new Map(entries.map((e) => [e.name.slice(top.length + 1), e.data]));
  const contents = names.map((n) => `${sha256(byName.get(n))} *${n}`).join("\n") + "\n";
  add("CONTENIDO.sha256", Buffer.from(contents, "utf8"));

  fs.mkdirSync(o.out, { recursive: true });
  const zip = createZip(entries, { mtime: sourceDate() });
  const zipPath = path.join(o.out, `${top}.zip`);
  fs.writeFileSync(zipPath, zip);
  const zipSha = sha256(zip);
  const sumsPath = path.join(o.out, "SHA256SUMS.txt");
  fs.writeFileSync(sumsPath, `${zipSha} *${top}.zip\n`);
  return { zipPath, sumsPath, zipSha256: zipSha, files: entries.length };
}

function sourceDate() {
  const epoch = process.env.SOURCE_DATE_EPOCH;
  return epoch && /^\d+$/.test(epoch) ? new Date(Number(epoch) * 1000) : new Date(Date.UTC(2026, 0, 1));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const get = (flag, def) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : def);
  const exe = get("--exe");
  const updater = get("--updater");
  const version = get("--version");
  if (!exe || !updater || !version) {
    console.error("uso: node scripts/package-release.mjs --exe <PESHeX.exe> --updater <PESHeX-Updater.exe> --version <X.Y.Z> [--out dir] [--ruby dir] [--rxdata dir]");
    process.exit(2);
  }
  try {
    const r = packageRelease({ exe, updater, version, out: get("--out", "release-out"), ruby: get("--ruby"), rxdata: get("--rxdata") });
    console.log(`zip: ${r.zipPath}\nsha256: ${r.zipSha256}\narchivos: ${r.files}`);
  } catch (e) {
    console.error(`error: ${e.message}`);
    process.exit(1);
  }
}
