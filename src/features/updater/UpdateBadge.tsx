import { Download } from "lucide-react";
import { cx } from "../../ui";
import { useT } from "../../lib/useT";
import { useUpdater } from "../../stores/updater";
import styles from "./updater.module.css";

/** Botoncito de la cabecera: hay una actualizacion (o se esta descargando) y el dialogo esta oculto; un clic lo vuelve a abrir.
 *  `variant="pill"` (pantalla de inicio): lleva texto y sugiere descargar e instalar; sigue oculto mientras no haya version nueva. */
export function UpdateBadge({ className, variant = "icon" }: { className?: string; variant?: "icon" | "pill" }) {
  const { t } = useT();
  const phase = useUpdater((s) => s.phase);
  const release = useUpdater((s) => s.release);
  const dialogOpen = useUpdater((s) => s.dialogOpen);
  const openDialog = useUpdater((s) => s.openDialog);
  const visible = release != null && !dialogOpen && phase !== "idle" && phase !== "checking";
  if (!visible) return null;
  const label = phase === "ready" ? t("updater.badgeReady", { version: release.version }) : t("updater.badge", { version: release.version });
  if (variant === "pill") {
    const text =
      phase === "available" || phase === "failed"
        ? t("updater.homeAvailable", { version: release.version })
        : phase === "ready"
          ? t("updater.homeReady", { version: release.version })
          : t("updater.homeBusy", { version: release.version });
    return (
      <button type="button" className={cx(styles.pill, phase === "ready" && styles.pillReady, className)} onClick={openDialog} aria-label={label} title={label} data-testid="update-badge">
        <Download size={15} aria-hidden="true" />
        {text}
      </button>
    );
  }
  return (
    <button type="button" className={cx(styles.badge, className)} onClick={openDialog} aria-label={label} title={label} data-testid="update-badge">
      <Download size={16} />
      <span className={cx(styles.dot, phase === "ready" && styles.dotReady)} aria-hidden="true" />
    </button>
  );
}
