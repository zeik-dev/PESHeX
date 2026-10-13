/** Reparto de géneros (% macho, % hembra) de un `GenderRatio` de Essentials; null = sin género o desconocido. */
export function genderSplit(ratio: string | null | undefined): { male: number; female: number } | null {
  if (!ratio) return null;
  const key = ratio.replace(/[_\s]/g, "").toLowerCase();
  const known: Record<string, number> = {
    alwaysmale: 0,
    femaleoneeighth: 12.5,
    female25percent: 25,
    female50percent: 50,
    female75percent: 75,
    femaleseveneighths: 87.5,
    alwaysfemale: 100,
  };
  if (key === "genderless") return null;
  const female = known[key];
  if (female === undefined) return null;
  return { male: 100 - female, female };
}

/** «12,5 % ♀» → texto compacto; null si no hay reparto (sin género). */
export function genderLabel(ratio: string | null | undefined, num: (n: number) => string): string | null {
  const g = genderSplit(ratio);
  if (!g) return null;
  if (g.female === 0) return `100 % ♂`;
  if (g.male === 0) return `100 % ♀`;
  return `${num(g.male)} % ♂ · ${num(g.female)} % ♀`;
}

/** Total de los stats base. */
export function statTotal(base: Record<string, number> | null | undefined): number {
  return base ? Object.values(base).reduce((a, b) => a + (typeof b === "number" ? b : 0), 0) : 0;
}
