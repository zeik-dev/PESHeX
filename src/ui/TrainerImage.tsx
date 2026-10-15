import { useEffect, useMemo, useState } from "react";
import type { TrainerLook } from "../api/types";
import { resolveBadgeSheet, resolveTrainerImage } from "../game/resolve/trainer";
import { useGame } from "../stores/game";
import { GameImage } from "./GameImage";
import styles from "./ui.module.css";
import { cx } from "./cx";
import { Sprite } from "./visual";

/** Imagen del entrenador con los gráficos del juego (clase de entrenador + atuendo, según el save y PBS/metadata.txt); sin
 *  ella, el marcador de color de siempre. */
export function TrainerImage({
  look,
  name,
  id,
  size = 96,
  className,
}: {
  look: TrainerLook | null | undefined;
  name: string;
  id?: string | number | null;
  size?: number;
  className?: string;
}) {
  const ctx = useGame((s) => s.ctx);
  const resolved = useMemo(
    () => (ctx && look ? resolveTrainerImage(ctx, { internal: look.internal, number: look.number, outfit: look.outfit }) : null),
    [ctx, look],
  );
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [resolved?.path]);
  if (!resolved || broken) return <Sprite name={name} id={id ?? name} size={Math.min(size, 72)} />;
  const ratio = resolved.h > 0 && resolved.w > 0 ? resolved.w / resolved.h : 1;
  return (
    <span className={cx(styles.trainerImage, className)} data-source="game" data-via={resolved.via}>
      <GameImage rel={resolved.path} size={size} frameRatio={ratio} alt={name} onFailed={() => setBroken(true)} />
    </span>
  );
}

/** Hoja de medallas del juego (null si no la trae: se usan los círculos numerados). */
export function useBadgeSheet() {
  const ctx = useGame((s) => s.ctx);
  return useMemo(() => (ctx ? resolveBadgeSheet(ctx) : null), [ctx]);
}

/** Medalla `index` (0 = la primera) de la hoja del juego; si no se tiene, apagada (gris y translúcida). */
export function BadgeIcon({
  sheet,
  index,
  got,
  size = 32,
  label,
}: {
  sheet: NonNullable<ReturnType<typeof useBadgeSheet>>;
  index: number;
  got: boolean;
  size?: number;
  label: string;
}) {
  const col = index % sheet.cols;
  const row = Math.floor(index / sheet.cols);
  if (row >= sheet.rows) return null;
  return (
    <span className={cx(styles.badgeIcon, !got && styles.badgeOffIcon)} role="img" aria-label={label} title={label} data-got={got}>
      <GameImage rel={sheet.path} size={size} frames={sheet.cols} rows={sheet.rows} row={row} col={col} />
    </span>
  );
}
