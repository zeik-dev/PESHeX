import { Download } from "lucide-react";
import { cx } from "../../ui";
import { useT } from "../../lib/useT";
import { useUpdater } from "../../stores/updater";
import styles from "./updater.module.css";

/** Botoncito de la cabecera: hay una actualizacion (o se esta descargando) y el dialogo esta oculto; un clic lo vuelve a abrir. */
export function UpdateBadge({ className }: { className?: string }) {
  const { t } = useT();
  const phase = useUpdater((s) => s.phase);
  const release = useUpdater((s) => s.release);
  const dialogOpen = useUpdater((s) => s.dialogOpen);
  const openDialog = useUpdater((s) => s.openDialog);
  const visible = release != null && !dialogOpen && phase !== "idle" && phase !== "checking";
  if (!visible) return null;
  const label = phase === "ready" ? t("updater.badgeReady", { version: release.version }) : t("updater.badge", { version: release.version });
  return (
    <button type="button" className={cx(styles.badge, className)} onClick={openDialog} aria-label={label} title={label} data-testid="update-badge">
      <Download size={16} />
      <span className={cx(styles.dot, phase === "ready" && styles.dotReady)} aria-hidden="true" />
    </button>
  );
}
