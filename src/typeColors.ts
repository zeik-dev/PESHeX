// Paleta de tipos, portada de los colores ANSI del CLI (modulo C /
// UI.tag_for / UI.conf_color en edit_rxdata.rb) a clases CSS.

export function typeColorClass(kind: string | undefined): string {
  if (!kind) return "t-other";
  if (kind === "nil") return "t-nil";
  if (kind === "bool") return "t-bool";
  if (kind === "int" || kind === "float") return "t-num";
  if (kind === "str") return "t-str";
  if (kind === "sym") return "t-sym";
  if (kind === "array" || kind === "hash" || kind.startsWith("obj:")) return "t-obj";
  return "t-other";
}

export function confidenceClass(confidence: string | null | undefined): string {
  if (confidence === "alta") return "conf-alta";
  if (confidence === "media") return "conf-media";
  if (confidence === "baja") return "conf-baja";
  return "conf-none";
}
