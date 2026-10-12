import { typeStyle } from "../lib/typeColors";
import styles from "./ui.module.css";

/** Chip de tipo con paleta propia; el texto siempre esta (no solo color). */
export function TypeChip({ id, name }: { id: string | null | undefined; name?: string | null }) {
  if (!id) return null;
  const label = name || id.charAt(0) + id.slice(1).toLowerCase();
  return (
    <span className={styles.typeChip} style={typeStyle(id)}>
      {label}
    </span>
  );
}
