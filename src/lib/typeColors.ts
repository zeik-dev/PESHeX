// Paleta propia de los 18 tipos (no copia ningun arte del juego). El texto del
// chip se elige con contraste suficiente: el tipo nunca depende solo del color.

const COLORS: Record<string, string> = {
  NORMAL: "#8a8a78", FIRE: "#e8601c", WATER: "#3b82d6", ELECTRIC: "#e6b800", GRASS: "#4aa840", ICE: "#5fc2c8",
  FIGHTING: "#b83a2e", POISON: "#9a4aa8", GROUND: "#c8a24a", FLYING: "#7a8fe0", PSYCHIC: "#e0508a", BUG: "#8aa81c",
  ROCK: "#a89040", GHOST: "#6a4f9a", DRAGON: "#5a38d8", DARK: "#5a4a42", STEEL: "#7a8aa0", FAIRY: "#e88ab8",
};
const FALLBACK = "#6b7280";

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

export function typeStyle(id: string | null | undefined): { background: string; color: string } {
  const bg = (id && COLORS[id.toUpperCase()]) || FALLBACK;
  // Texto negro o blanco: el que de mayor contraste.
  const l = luminance(bg);
  const contrastWhite = 1.05 / (l + 0.05);
  const contrastBlack = (l + 0.05) / 0.05;
  return { background: bg, color: contrastWhite >= contrastBlack ? "#ffffff" : "#111111" };
}

export const TYPE_IDS = Object.keys(COLORS);
