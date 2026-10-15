import { ExternalLink } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useT } from "../../lib/useT";
import { formatBytes, formatDuration } from "../../lib/format";
import { isBusy, useUpdater } from "../../stores/updater";
import { Banner, Button, Chip, ConfirmDialog, LoadProgress, Modal } from "../../ui";
import { ReleaseNotes } from "./ReleaseNotes";
import styles from "./updater.module.css";

/** Traduce el codigo de error del actualizador (con respaldo generico). */
export function useUpdateErrorText() {
  const { dyn } = useT();
  return (code: string) => {
    const key = `updater.error.${code}`;
    return dyn(key) === key ? dyn("updater.error.default") : dyn(key);
  };
}

export function UpdateProgressView() {
  const { t, dyn, locale } = useT();
  const phase = useUpdater((s) => s.phase);
  const p = useUpdater((s) => s.progress);
  const downloading = phase === "downloading" || phase === "paused";
  const value = phase === "downloading" || phase === "paused" ? (p.total > 0 ? p.downloaded / p.total : 0) : 1;
  const eta = p.bytesPerSec > 0 && p.total > p.downloaded ? (p.total - p.downloaded) / p.bytesPerSec : null;
  return (
    <div className={styles.progress}>
      <LoadProgress value={value} label={dyn(`updater.state.${phase}`)} />
      {downloading && (
        <div className={styles.stats} data-testid="update-stats">
          <span>{t("updater.downloaded", { done: formatBytes(p.downloaded, locale), total: formatBytes(p.total, locale) })}</span>
          {phase === "downloading" && p.bytesPerSec > 0 && <span>{t("updater.speed", { speed: formatBytes(p.bytesPerSec, locale) })}</span>}
          {phase === "downloading" && eta != null && <span>{t("updater.eta", { time: formatDuration(eta) })}</span>}
        </div>
      )}
    </div>
  );
}

/** Dialogo global de actualizacion: version nueva, descarga con progreso (pausar / reanudar / cancelar), instalacion y errores. */
export function UpdateDialog() {
  const { t, locale } = useT();
  const errText = useUpdateErrorText();
  const u = useUpdater();
  const rel = u.release;
  const open = u.dialogOpen && (rel != null || u.phase === "failed");
  if (!open) {
    return (
      <ConfirmDialog open={u.confirmUnsaved} danger title={t("updater.unsaved.title")} confirmLabel={t("updater.unsaved.confirm")}
        onConfirm={() => void u.apply(true)} onCancel={u.dismissUnsaved}>
        <p>{t("updater.unsaved.body")}</p>
      </ConfirmDialog>
    );
  }

  let footer;
  let body;
  if (u.phase === "failed") {
    footer = (
      <>
        <Button variant="primary" onClick={() => { u.clearFailure(); if (rel) void u.start(); }}>{t("updater.retry")}</Button>
        <Button onClick={() => { u.clearFailure(); u.hideDialog(); }}>{t("common.close")}</Button>
      </>
    );
    body = (
      <Banner tone="bad" title={t("updater.failed")}>
        {errText(u.error?.code ?? "default")}
        {u.error?.message && <p className={`muted mono ${styles.detail}`}>{u.error.message}</p>}
      </Banner>
    );
  } else if (u.phase === "available" && rel) {
    footer = (
      <>
        <Button variant="primary" onClick={() => void u.start()}>{t("updater.download")}</Button>
        <Button onClick={u.hideDialog}>{t("updater.later")}</Button>
        <Button variant="ghost" onClick={u.skip}>{t("updater.skip")}</Button>
      </>
    );
  } else if (u.phase === "ready") {
    footer = (
      <>
        <Button variant="primary" onClick={() => void u.apply()}>{t("updater.install")}</Button>
        <Button onClick={u.hideDialog}>{t("updater.later")}</Button>
      </>
    );
  } else if (u.phase === "applying") {
    footer = null;
  } else {
    // descargando / pausada / verificando / preparando
    footer = (
      <>
        {u.phase === "paused" ? (
          <Button variant="primary" onClick={() => void u.resume()}>{t("updater.resume")}</Button>
        ) : (
          <Button disabled={u.phase !== "downloading"} onClick={() => void u.pause()}>{t("updater.pause")}</Button>
        )}
        <Button variant="danger" disabled={u.phase !== "downloading" && u.phase !== "paused"} onClick={() => void u.cancel()}>{t("updater.cancel")}</Button>
        <Button variant="ghost" onClick={u.hideDialog}>{t("updater.hide")}</Button>
      </>
    );
  }

  return (
    <>
      <Modal open title={t("updater.dialogTitle")} onClose={u.phase === "applying" ? () => undefined : u.hideDialog} footer={footer}>
        {rel && (
          <>
            <p className={styles.intro}>{t("updater.intro", { version: rel.version, current: __APP_VERSION__ })}</p>
            <div className={styles.meta}>
              <Chip tone="info">{t("updater.size", { size: formatBytes(rel.asset.size, locale) })}</Chip>
              {rel.prerelease && <Chip tone="warn">{t("updater.prerelease")}</Chip>}
              {rel.url && (
                <Button size="sm" variant="ghost" onClick={() => void openUrl(rel.url).catch(() => undefined)}>
                  <ExternalLink size={14} /> {t("updater.openRelease")}
                </Button>
              )}
            </div>
          </>
        )}
        {body}
        {u.phase === "available" && rel && rel.notes && <ReleaseNotes notes={rel.notes} />}
        {isBusy(u.phase) && u.phase !== "checking" && <UpdateProgressView />}
        {u.phase === "ready" && <p style={{ marginBottom: 0 }}>{t("updater.readyHelp")}</p>}
        {u.phase === "applying" && <p className="muted" style={{ marginBottom: 0 }}>{t("updater.applyingHelp")}</p>}
      </Modal>
      <ConfirmDialog open={u.confirmUnsaved} danger title={t("updater.unsaved.title")} confirmLabel={t("updater.unsaved.confirm")}
        onConfirm={() => void u.apply(true)} onCancel={u.dismissUnsaved}>
        <p>{t("updater.unsaved.body")}</p>
      </ConfirmDialog>
    </>
  );
}
