// Que se deja fuera del Ruby portatil al empaquetar. Solo se quita lo que PESHeX NO usa
// (documentacion, cabeceras de C, ejecutables de gemas, cache de gemas): el driver solo
// necesita ruby.exe, sus DLL y la biblioteca estandar. Si algo necesario se quitara, el
// test de humo del release (scripts/smoke-release.ps1) lo detecta antes de publicar.

const DROP_DIRS = [
  "share/ri", "share/doc", "share/man", "include", "packages", "ridk_use",
];
const DROP_GLOBS = [
  /^lib\/ruby\/gems\/[^/]+\/(doc|cache)\//,
  /^lib\/ruby\/gems\/[^/]+\/gems\/[^/]+\/(doc|test|spec|benchmark)\//,
  /^bin\/[^/]+\.(bat|cmd|ps1)$/i,
];
// Scripts de Ruby sin extension que trae bin/ (gem, irb, rake...): no hacen falta para ejecutar la app.
const DROP_BIN = new Set([
  "bundle", "bundler", "erb", "gem", "irb", "racc", "rake", "rbs", "rdbg", "rdoc", "ri", "typeprof", "startmenu.rb",
]);

/** `rel` es la ruta relativa dentro del Ruby portatil, con '/'. */
export function shouldKeep(rel) {
  const p = rel.replace(/\\/g, "/");
  if (DROP_DIRS.some((d) => p === d || p.startsWith(`${d}/`))) return false;
  if (DROP_GLOBS.some((re) => re.test(p))) return false;
  if (p.startsWith("bin/") && DROP_BIN.has(p.slice(4))) return false;
  return true;
}

/** Lo imprescindible: si falta alguno, el empaquetado debe fallar en vez de publicar un zip roto. */
export const REQUIRED_RUBY_FILES = ["bin/ruby.exe", "lib/ruby"];
