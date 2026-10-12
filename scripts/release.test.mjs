// Pruebas del empaquetado del release: node --test scripts/
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { check } from "./check-version.mjs";
import { createZip, crc32, dosDateTime } from "./lib/zip.mjs";
import { shouldKeep } from "./lib/trim.mjs";
import { leemeFor, packageRelease, sha256, walk } from "./package-release.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hasUnzip = spawnSync("unzip", ["-v"]).status === 0;

function tmp(tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `peshex-rel-${tag}-`));
}

test("crc32 coincide con el valor conocido", () => {
  assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926);
  assert.equal(crc32(Buffer.alloc(0)), 0);
});

test("fecha MS-DOS", () => {
  const d = dosDateTime(new Date(Date.UTC(2026, 0, 2, 3, 4, 6)));
  assert.equal(d.date, ((2026 - 1980) << 9) | (1 << 5) | 2);
  assert.equal(d.time, (3 << 11) | (4 << 5) | 3);
});

test("el zip es determinista y rechaza nombres peligrosos", () => {
  const entries = [{ name: "b/x.txt", data: Buffer.from("hola") }, { name: "a.txt", data: Buffer.from("mundo") }];
  const z1 = createZip(entries);
  const z2 = createZip([...entries].reverse());
  assert.deepEqual(z1, z2);
  for (const bad of ["/abs.txt", "../fuera.txt", "a/../b.txt", "a\\b.txt"]) {
    assert.throws(() => createZip([{ name: bad, data: Buffer.alloc(1) }]), /no permitido/);
  }
});

test("unzip lee el zip, con nombres con ñ y archivos vacios o incompresibles", { skip: !hasUnzip }, () => {
  const dir = tmp("zip");
  const random = Buffer.alloc(5000);
  for (let i = 0; i < random.length; i++) random[i] = (i * 2654435761) >>> 24;
  const entries = [
    { name: "raiz/hola mundo/ñandú.txt", data: Buffer.from("contenido ñ\n".repeat(100)) },
    { name: "raiz/vacio.bin", data: Buffer.alloc(0) },
    { name: "raiz/random.bin", data: random },
  ];
  const zip = path.join(dir, "t.zip");
  fs.writeFileSync(zip, createZip(entries));
  execFileSync("unzip", ["-tq", zip]);
  const out = path.join(dir, "out");
  execFileSync("unzip", ["-q", "-d", out, zip]);
  assert.equal(fs.readFileSync(path.join(out, "raiz/hola mundo/ñandú.txt"), "utf8"), "contenido ñ\n".repeat(100));
  assert.equal(fs.readFileSync(path.join(out, "raiz/vacio.bin")).length, 0);
  assert.deepEqual(fs.readFileSync(path.join(out, "raiz/random.bin")), random);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("el recorte del Ruby quita documentacion y deja lo necesario", () => {
  const drop = ["share/ri/x.ri", "share/doc/a", "include/ruby.h", "bin/gem", "bin/irb.bat", "bin/gem.cmd", "bin/ridk.ps1",
    "lib/ruby/gems/4.0.0/doc/x/index.html", "lib/ruby/gems/4.0.0/cache/x.gem", "packages/x", "ridk_use/y"];
  const keep = ["bin/ruby.exe", "bin/rubyw.exe", "bin/libruby.4.0.dll", "bin/ruby_builtin_dlls/zlib1.dll",
    "lib/ruby/4.0.0/json.rb", "lib/ruby/4.0.0/x64-mingw-ucrt/zlib.so", "lib/ruby/gems/4.0.0/gems/json-2.0/lib/json.rb", "LICENSE.txt"];
  for (const p of drop) assert.equal(shouldKeep(p), false, p);
  for (const p of keep) assert.equal(shouldKeep(p), true, p);
});

function fakeInstall() {
  const dir = tmp("pkg");
  const w = (rel, text = "x") => {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text);
  };
  w("exe/PESHeX.exe", "MZ-fake");
  w("ruby/bin/ruby.exe", "ruby");
  w("ruby/lib/ruby/4.0.0/json.rb", "json");
  w("ruby/share/ri/gigante.ri", "x".repeat(1000));
  w("ruby/.ruby-version-installed", "4.0.7-1");
  w("rxdata/edit_rxdata.rb", "# edit");
  w("rxdata/driver/rxdata_driver.rb", "# driver");
  return dir;
}

test("package-release arma el zip con la estructura, los hashes y el LEEME", { skip: !hasUnzip }, () => {
  const dir = fakeInstall();
  const r = packageRelease({ exe: path.join(dir, "exe/PESHeX.exe"), version: "9.8.7", out: path.join(dir, "out"),
    ruby: path.join(dir, "ruby"), rxdata: path.join(dir, "rxdata") });
  assert.match(path.basename(r.zipPath), /^PESHeX-9\.8\.7-windows-x64\.zip$/);
  const listing = execFileSync("unzip", ["-Z1", r.zipPath]).toString().trim().split("\n");
  const top = "PESHeX-9.8.7-windows-x64/";
  for (const f of ["PESHeX.exe", "ruby/bin/ruby.exe", "ruby/lib/ruby/4.0.0/json.rb", "rxdata/driver/rxdata_driver.rb", "LEEME.txt",
    "LICENSE", "THIRD-PARTY-NOTICES.txt", "CONTENIDO.sha256"]) {
    assert.ok(listing.includes(top + f), `falta ${f}`);
  }
  assert.ok(!listing.some((n) => n.includes("share/ri")), "la documentacion de Ruby no debe ir");
  assert.ok(!listing.some((n) => n.includes(".ruby-version-installed")));

  const out = path.join(dir, "ex");
  execFileSync("unzip", ["-q", "-d", out, r.zipPath]);
  const root = path.join(out, top.slice(0, -1));
  // CONTENIDO.sha256 describe exactamente lo extraido
  const lines = fs.readFileSync(path.join(root, "CONTENIDO.sha256"), "utf8").trim().split("\n");
  for (const line of lines) {
    const [hash, name] = [line.slice(0, 64), line.slice(66)];
    assert.equal(createHash("sha256").update(fs.readFileSync(path.join(root, name))).digest("hex"), hash, name);
  }
  assert.equal(lines.length, walk(root).length - 1, "todo archivo (menos el propio indice) esta listado");
  // SHA256SUMS.txt describe el zip
  assert.equal(fs.readFileSync(r.sumsPath, "utf8"), `${sha256(fs.readFileSync(r.zipPath))} *${path.basename(r.zipPath)}\n`);
  // LEEME con la version y saltos CRLF
  const leeme = fs.readFileSync(path.join(root, "LEEME.txt"), "utf8");
  assert.ok(leeme.includes("PESHeX 9.8.7") && leeme.includes("\r\n") && !leeme.includes("{{VERSION}}"));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("package-release es reproducible", () => {
  const dir = fakeInstall();
  const o = { exe: path.join(dir, "exe/PESHeX.exe"), version: "1.2.3", ruby: path.join(dir, "ruby"), rxdata: path.join(dir, "rxdata") };
  const a = packageRelease({ ...o, out: path.join(dir, "o1") });
  const b = packageRelease({ ...o, out: path.join(dir, "o2") });
  assert.equal(a.zipSha256, b.zipSha256);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("package-release falla si falta algo imprescindible", () => {
  const dir = fakeInstall();
  fs.rmSync(path.join(dir, "ruby/bin/ruby.exe"));
  assert.throws(
    () => packageRelease({ exe: path.join(dir, "exe/PESHeX.exe"), version: "1.0.0", out: path.join(dir, "o"), ruby: path.join(dir, "ruby"), rxdata: path.join(dir, "rxdata") }),
    /bin\/ruby\.exe/,
  );
  assert.throws(() => packageRelease({ exe: path.join(dir, "nope.exe"), version: "1.0.0", out: path.join(dir, "o") }), /ejecutable/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("LEEME sin marcadores sin sustituir", () => {
  assert.ok(!leemeFor("1.0.0").includes("{{"));
});

test("check-version: coincidencia de versiones y de tag", () => {
  const dir = tmp("ver");
  const w = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  };
  const setup = (a, b, c) => {
    w("package.json", JSON.stringify({ version: a }));
    w("src-tauri/Cargo.toml", `[package]\nname = "peshex"\nversion = "${b}"\n\n[dependencies]\nserde = { version = "1" }\n`);
    w("src-tauri/tauri.conf.json", JSON.stringify({ version: c }));
  };
  setup("1.0.0", "1.0.0", "1.0.0");
  assert.deepEqual(check(dir, "v1.0.0").errors, []);
  assert.equal(check(dir, "v1.0.0").prerelease, false);
  assert.match(check(dir, "v1.0.1").errors[0], /no coincide/);
  assert.equal(check(dir, "ci-3").prerelease, true);
  assert.deepEqual(check(dir, "ci-3").errors, []);
  assert.match(check(dir, "release-1").errors[0], /no reconocido/);
  setup("1.0.0", "1.0.1", "1.0.0");
  assert.match(check(dir, "").errors[0], /no coinciden/);
  setup("1.0.0-rc.1", "1.0.0-rc.1", "1.0.0-rc.1");
  assert.equal(check(dir, "v1.0.0-rc.1").prerelease, true);
  setup("uno", "uno", "uno");
  assert.match(check(dir).errors.join(), /semver/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("las versiones reales del repositorio coinciden entre si", () => {
  const r = check(ROOT);
  assert.deepEqual(r.errors, []);
});
