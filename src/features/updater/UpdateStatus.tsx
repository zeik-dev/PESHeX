import { AlertTriangle, Check, RefreshCw } from "lucide-react";
import { useT } from "../../lib/useT";
import { useUpdater } from "../../stores/updater";
import { cx } from "../../ui";
import { useUpdateErrorText } from "./UpdateDialog";
import styles from "./updater.module.css";

/** Chip de la pantalla de inicio con el estado de la busqueda automatica al arrancar: buscando, al dia o con error. */
export function UpdateStatus({ className }: { className?: string }) {
  const { t } = useT();
  const errText = useUpdateErrorText();
  const notice = useUpdater((s) => s.notice);
  if (!notice) return null;

  let icon;
  let text: string;
  let title: string | undefined;
  if (notice.kind === "checking") {
    icon = <RefreshCw size={14} className={styles.spin} aria-hidden="true" />;
    text = t("updater.statusChecking");
  } else if (notice.kind === "upToDate") {
    icon = <Check size={14} aria-hidden="true" />;
    text = t("updater.statusUpToDate");
    title = t("updater.upToDate", { version: notice.version });
  } else {
    icon = <AlertTriangle size={14} aria-hidden="true" />;
    text = t("updater.statusFailed");
    title = `${errText(notice.code)} ${notice.message}`.trim();
  }
  return (
    <span className={cx(styles.status, notice.kind === "error" && styles.statusError, className)} role="status" title={title} data-testid="update-status" data-kind={notice.kind}>
      {icon}
      {text}
    </span>
  );
}
