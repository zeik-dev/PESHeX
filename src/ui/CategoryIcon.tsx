import { useMemo, useState } from "react";
import { resolveCategorySheet } from "../game/resolve/category";
import { useT } from "../lib/useT";
import { useGame } from "../stores/game";
import { GameImage } from "./GameImage";
import styles from "./ui.module.css";

/** Categoría de un movimiento: 0 Físico, 1 Especial, 2 Estado (null/otro = desconocida). */
export type MoveCategory = 0 | 1 | 2;

const KEYS = ["pokemon.moves.physical", "pokemon.moves.special", "pokemon.moves.status"] as const;

const CX = 32;
const CY = 14;
const pts = (list: [number, number][]) => list.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
/** Estrella de 8 puntas (impacto) y espiral de 2,5 vueltas, calculadas una vez. */
const STAR = pts(Array.from({ length: 16 }, (_, i) => {
  const a = (i * Math.PI) / 8 - Math.PI / 2;
  const r = i % 2 === 0 ? 11.5 : 5;
  return [CX + r * Math.cos(a), CY + r * Math.sin(a)] as [number, number];
}));
const SPIRAL = pts(Array.from({ length: 70 }, (_, i) => {
  const a = (i / 69) * Math.PI * 5;
  const r = 0.6 + 0.52 * a;
  return [CX + r * Math.cos(a), CY + r * Math.sin(a)] as [number, number];
}));

/** Iconos PROPIOS (diseño original, formas geométricas y los colores convencionales: naranja, azul y gris) para cuando el
 *  juego no trae su `category.png`. Cuadro de 64×28, la misma proporción que el de Essentials. */
function CategorySvg({ category, height }: { category: MoveCategory; height: number }) {
  const bg = ["#c4501c", "#4a5fb8", "#7b8794"][category];
  return (
    <svg viewBox="0 0 64 28" width={Math.round((height * 64) / 28)} height={height} aria-hidden="true" focusable="false">
      <rect x="0.5" y="0.5" width="63" height="27" rx="7" fill={bg} stroke="rgb(0 0 0 / 25%)" />
      {category === 0 && <polygon points={STAR} fill="#fff" />}
      {category === 1 && <polyline points={SPIRAL} fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />}
      {category === 2 && (
        <>
          <circle cx={CX} cy={CY} r="8.5" fill="none" stroke="#fff" strokeWidth="2.4" />
          <path d={`M${CX} ${CY - 8.5} a8.5 8.5 0 0 0 0 17 z`} fill="#fff" />
        </>
      )}
    </svg>
  );
}

/** Ícono de categoría de un movimiento (Físico / Especial / Estado): el de la carpeta del juego (`category.png`, 3 cuadros
 *  apilados) y, si no lo trae, un ícono propio. `role="img"` con el nombre de la categoría. */
export function CategoryIcon({ category, height = 16 }: { category: number | null | undefined; height?: number }) {
  const { t } = useT();
  const ctx = useGame((s) => s.ctx);
  const sheet = useMemo(() => (ctx ? resolveCategorySheet(ctx) : null), [ctx]);
  const [broken, setBroken] = useState(false);
  if (category !== 0 && category !== 1 && category !== 2) return null;
  const label = t(KEYS[category]);
  return (
    <span className={styles.categoryIcon} role="img" aria-label={label} title={label} data-category={category} data-source={sheet && !broken ? "game" : "own"}>
      {sheet && !broken ? (
        <GameImage rel={sheet.path} size={height} frameRatio={sheet.frameW / sheet.frameH} rows={3} row={category} onFailed={() => setBroken(true)} />
      ) : (
        <CategorySvg category={category} height={height} />
      )}
    </span>
  );
}
