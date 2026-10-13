import { PokeballIcon } from "./Pokeball";
import styles from "./ui.module.css";

/** Progreso de una carga con pasos reales: Poké Ball girando + barra de compleción (`role="progressbar"`).
 *  `value` en 0..1; `label` es el paso actual («Leyendo especies…»). */
export function LoadProgress({ value, label, size = 36 }: { value: number; label: string; size?: number }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div className={styles.loadProgress}>
      <PokeballIcon size={size} className={styles.spinner} />
      <div className={styles.loadBody}>
        <div className={styles.loadLabel}>
          <span>{label}</span>
          <span className="mono">{pct} %</span>
        </div>
        <div
          className={styles.loadTrack}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          aria-valuetext={`${label} (${pct} %)`}
        >
          <div className={styles.loadFill} style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  );
}
