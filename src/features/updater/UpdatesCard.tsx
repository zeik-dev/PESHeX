import { RefreshCw } from "lucide-react";
import { useT } from "../../lib/useT";
import { useSettings } from "../../stores/settings";
import { isBusy, useUpdater } from "../../stores/updater";
import { Banner, Button, Card, Chip, Switch } from "../../ui";
import { UpdateProgressView, useUpdateErrorText } from "./UpdateDialog";
import styles from "./updater.module.css";

/** «Actualizaciones» en Ajustes: version instalada, buscar ahora, buscar al iniciar y estado de la descarga. */
export function UpdatesCard() {
  const { t } = useT();
  const errText = useUpdateErrorText();
  const u = useUpdater();
  const onStart = useSettings((s) => s.updateCheckOnStart);
  const setOnStart = useSettings((s) => s.setUpdateCheckOnStart);
  const skipped = useSettings((s) => s.updateSkipped);
  const setSkipped = useSettings((s) => s.setUpdateSkipped);

  if (u.supported === false) {
    return (
      <Card title={t("updater.title")}>
        <p className="muted" style={{ margin: 0 }}>{t("settings.version", { version: __APP_VERSION__ })}</p>
        <p className="muted" style={{ marginBottom: 0 }} data-testid="update-unsupported">{t("updater.unsupported")}</p>
      </Card>
    );
  }

  const checking = u.phase === "checking";
  const rel = u.release;
  return (
    <Card title={t("updater.title")}>
      <div className={styles.cardRow}>
        <span className="muted mono">{t("settings.version", { version: __APP_VERSION__ })}</span>
        <Button disabled={isBusy(u.phase)} onClick={() => void u.check(true)}>
          <RefreshCw size={14} /> {checking ? t("updater.checking") : t("updater.checkNow")}
        </Button>
        {rel && (u.phase === "available" || u.phase === "ready" || u.phase === "failed") && (
          <Button variant="primary" onClick={u.openDialog}>{t("updater.viewUpdate", { version: rel.version })}</Button>
        )}
      </div>

      {u.phase === "available" && rel && (
        <p className={styles.cardStatus}>
          <Chip tone="good">{t("updater.available", { version: rel.version })}</Chip>
        </p>
      )}
      {isBusy(u.phase) && u.phase !== "checking" && (
        <div className={styles.cardStatus}>
          <UpdateProgressView />
        </div>
      )}
      {u.lastCheck?.status === "upToDate" && <p className={styles.cardStatus} data-testid="update-uptodate">{t("updater.upToDate", { version: u.lastCheck.version })}</p>}
      {u.lastCheck?.status === "error" && (
        <div className={styles.cardStatus}>
          <Banner tone="warn" title={t("updater.checkFailed")}>
            {errText(u.lastCheck.code)}
            <p className={`muted mono ${styles.detail}`}>{u.lastCheck.message}</p>
          </Banner>
        </div>
      )}

      <label style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14 }}>
        <Switch checked={onStart} onChange={setOnStart} label={t("updater.checkOnStart")} />
        {t("updater.checkOnStart")}
      </label>
      {skipped && (
        <p className="muted" style={{ marginBottom: 0 }}>
          {t("updater.skippedInfo", { version: skipped })}{" "}
          <Button size="sm" variant="ghost" onClick={() => setSkipped(null)}>{t("updater.unskip")}</Button>
        </p>
      )}
    </Card>
  );
}
