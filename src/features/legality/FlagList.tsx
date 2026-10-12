import { AlertTriangle, Info, ShieldX } from "lucide-react";
import type { Flag } from "../../api/types";
import { flagText, sortFlags, type NameLookup } from "../../lib/legality";
import { useT } from "../../lib/useT";
import { useGame } from "../../stores/game";
import styles from "./legality.module.css";

export function SeverityIcon({ severity, size = 15 }: { severity: Flag["severity"]; size?: number }) {
  const { t } = useT();
  const label = t(`legality.severity.${severity}`);
  if (severity === "illegal") return <ShieldX size={size} className={styles.illegal} aria-label={label} role="img" />;
  if (severity === "warning") return <AlertTriangle size={size} className={styles.warning} aria-label={label} role="img" />;
  return <Info size={size} className={styles.info} aria-label={label} role="img" />;
}

/** Nombres del juego para los sujetos de las flags (movimientos, objetos, habilidades). */
export function useNameLookup(): NameLookup {
  const idx = useGame((s) => s.catalogIndex);
  return {
    move: (id) => idx?.moves.get(id)?.name ?? undefined,
    item: (id) => idx?.items.get(id)?.name ?? undefined,
    ability: (id) => idx?.abilities.get(id)?.name ?? undefined,
  };
}

/** Lista de flags con icono (nunca solo color), ordenadas de mas a menos grave. */
export function FlagList({ flags, showRef, limit }: { flags: Flag[]; showRef?: boolean; limit?: number }) {
  const { t } = useT();
  const names = useNameLookup();
  const sorted = sortFlags(flags);
  const shown = limit ? sorted.slice(0, limit) : sorted;
  return (
    <ul className={styles.list}>
      {shown.map((f, i) => (
        <li key={`${f.ref}-${f.code}-${f.subject}-${i}`} className={styles.item}>
          <SeverityIcon severity={f.severity} />
          <span>
            {showRef && f.ref && <strong className="mono">{f.ref}: </strong>}
            {flagText(t, f, names)}
          </span>
        </li>
      ))}
      {limit && sorted.length > limit && <li className="muted">{t("legality.more", { count: sorted.length - limit })}</li>}
    </ul>
  );
}
