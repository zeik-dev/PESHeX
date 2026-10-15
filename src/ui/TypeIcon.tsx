import { useMemo, useState } from "react";
import { resolveTypeSheet } from "../game/resolve/type";
import { typeStyle } from "../lib/typeColors";
import { useGame } from "../stores/game";
import { GameImage } from "./GameImage";
import styles from "./ui.module.css";

/** Icono de un tipo: el de la hoja `types.png` de la carpeta del juego (la fila la da `IconPosition` del PBS) y, si el juego
 *  no la trae, una etiqueta compacta de color con las 3 primeras letras (el tipo nunca depende solo del color). */
export function TypeIcon({ type, height = 16 }: { type: string | null | undefined; height?: number }) {
  const ctx = useGame((s) => s.ctx);
  const catalog = useGame((s) => s.catalogIndex);
  const sheet = useMemo(() => (ctx ? resolveTypeSheet(ctx) : null), [ctx]);
  const [broken, setBroken] = useState(false);
  if (!type) return null;
  const info = catalog?.types.get(type);
  const name = info?.name || type.charAt(0) + type.slice(1).toLowerCase();
  const row = info?.iconPosition;
  if (sheet && !broken && row != null && row >= 0 && row < sheet.rows) {
    return (
      <span className={styles.typeIcon} role="img" aria-label={name} title={name} data-type={type} data-source="game">
        <GameImage rel={sheet.path} size={height} frameRatio={sheet.frameW / sheet.frameH} rows={sheet.rows} row={row} onFailed={() => setBroken(true)} />
      </span>
    );
  }
  return (
    <span className={styles.typeIconText} style={{ ...typeStyle(type), height }} role="img" aria-label={name} title={name} data-type={type} data-source="own">
      {name.slice(0, 3).toUpperCase()}
    </span>
  );
}
