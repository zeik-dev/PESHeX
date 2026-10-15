/** Clave comparable de un nombre: sin acentos, en mayusculas y solo [A-Z0-9].
 *  "Mr. Mime" -> "MRMIME", "Pokémon Ball" -> "POKEMONBALL". */
export function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/** Nombre de archivo sin extension. */
export function stripExt(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(0, i) : name;
}

/** pad2(5) = "05" (iconos de bola de bases antiguas: summaryball05). */
export function pad2(n: number): string {
  return String(Math.trunc(n)).padStart(2, "0");
}

/** pad3(5) = "005" (nombres de assets numerados de bases antiguas). */
export function pad3(n: number): string {
  return String(Math.trunc(n)).padStart(3, "0");
}
