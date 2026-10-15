#!/usr/bin/env node
// Comprueba que la version de package.json, tauri.conf.json y los Cargo.toml del workspace (la app y sus crates,
// incluido el actualizador, que la muestra en `--version`) coinciden y, si se
// da un tag (--tag v1.0.0), que el tag la nombra. Imprime `version=`, `prerelease=` y `tag=` listos para
// $GITHUB_OUTPUT. Los tags de prueba `ci-*` no exigen coincidencia (nunca publican un Release).
//
//   node scripts/check-version.mjs [--tag <tag>] [--quiet]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

/** Cargo.toml de la app y de cada crate del workspace (`crates/*`). */
function cargoManifests(root) {
  const out = ["src-tauri/Cargo.toml"];
  const crates = path.join(root, "src-tauri", "crates");
  if (fs.existsSync(crates)) {
    for (const d of fs.readdirSync(crates).sort()) {
      if (fs.existsSync(path.join(crates, d, "Cargo.toml"))) out.push(`src-tauri/crates/${d}/Cargo.toml`);
    }
  }
  return out;
}

export function readVersions(root) {
  const versions = { "package.json": JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version };
  for (const rel of cargoManifests(root)) {
    const text = fs.readFileSync(path.join(root, rel), "utf8");
    versions[rel] = /^\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m.exec(text)?.[1];
  }
  versions["src-tauri/tauri.conf.json"] = JSON.parse(fs.readFileSync(path.join(root, "src-tauri", "tauri.conf.json"), "utf8")).version;
  return versions;
}

/** @returns {{ version: string, prerelease: boolean, tag: string, errors: string[] }} */
export function check(root, tag = "") {
  const errors = [];
  const versions = readVersions(root);
  const distinct = [...new Set(Object.values(versions))];
  if (distinct.length !== 1 || !distinct[0]) {
    errors.push(`las versiones no coinciden: ${JSON.stringify(versions)}`);
  }
  const version = distinct[0] ?? "";
  const m = SEMVER.exec(version);
  if (!m) errors.push(`la version "${version}" no es semver (X.Y.Z[-sufijo])`);

  let prerelease = !!m?.[4];
  if (tag) {
    if (/^v\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(tag)) {
      if (tag !== `v${version}`) errors.push(`el tag ${tag} no coincide con la version ${version}`);
    } else if (/^ci-/.test(tag)) {
      prerelease = true; // prueba de la pipeline: nunca se publica
    } else {
      errors.push(`tag no reconocido: ${tag}`);
    }
  }
  return { version, prerelease, tag, errors };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const tag = args.includes("--tag") ? args[args.indexOf("--tag") + 1] ?? "" : "";
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const r = check(root, tag);
  if (r.errors.length) {
    for (const e of r.errors) console.error(`error: ${e}`);
    process.exit(1);
  }
  console.log(`version=${r.version}`);
  console.log(`prerelease=${r.prerelease}`);
  console.log(`tag=${r.tag}`);
}
