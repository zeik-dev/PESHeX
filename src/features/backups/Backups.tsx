import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Archive, FileSearch, GitCompare, RotateCcw } from "lucide-react";
import { useState } from "react";
import { extras } from "../../api/extras";
import type { SaveDiff } from "../../api/types";
import { formatDateTime, formatNumber } from "../../lib/format";
import { useT } from "../../lib/useT";
import { toastError, useSession } from "../../stores/session";
import { useToasts } from "../../stores/toasts";
import { Banner, Button, Card, Chip, ConfirmDialog, EmptyState, PageTitle, PokeballSpinner } from "../../ui";
import { useSemanticQuery } from "../queries";
import shared from "../shared/shared.module.css";
import { DiffView } from "./DiffView";
import styles from "./backups.module.css";

/** Copias de seguridad junto al save: comparar (semantico) y restaurar (con copia previa del estado actual). */
export function Backups() {
  const { t, locale } = useT();
  const pending = useSession((s) => s.pendingCount);
  const filePath = useSession((s) => s.filePath);
  const q = useSemanticQuery("backups", extras.backups);
  const [diff, setDiff] = useState<{ title: string; diff: SaveDiff } | null>(null);
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);

  async function compare(title: string, run: () => Promise<SaveDiff>) {
    setBusy(true);
    try {
      setDiff({ title, diff: await run() });
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  }

  async function pickFile() {
    const file = await openDialog({ multiple: false, title: t("backups.pickTitle") });
    if (typeof file === "string") await compare(file, () => extras.diffAgainst(file));
  }

  async function restore(file: string) {
    setRestoring(null);
    setBusy(true);
    try {
      const r = await extras.restoreBackup(file);
      setDiff(null);
      if (filePath) await useSession.getState().open(filePath); // el archivo cambio en disco: se reabre
      useToasts.getState().push({ kind: "success", text: t("backups.restored"), detail: t("backups.safety", { file: r.safetyCopy }) });
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  }

  if (q.isPending) return <PokeballSpinner />;
  const list = q.data?.backups ?? [];

  return (
    <div className={shared.stack}>
      <PageTitle icon={<Archive />} title={t("backups.title")} subtitle={t("backups.subtitle")} />
      {pending > 0 && <Banner tone="info" title={t("backups.pendingTitle")}>{t("backups.pendingBody")}</Banner>}

      <Card title={t("backups.list")} actions={
        <Button size="sm" disabled={busy} onClick={() => void pickFile()}><FileSearch size={14} /> {t("backups.compareFile")}</Button>
      }>
        {list.length === 0 ? (
          <EmptyState>{t("backups.empty")}</EmptyState>
        ) : (
          <ul className={styles.list}>
            {list.map((b) => (
              <li key={b.file} className={styles.item}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className={styles.name} title={b.file}>{b.file}</div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {formatDateTime(b.mtime, locale)} · {t("backups.size", { size: formatNumber(Math.round(b.size / 1024), locale) })}
                  </div>
                </div>
                {b.kind === "prerestore" && <Chip tone="info">{t("backups.prerestore")}</Chip>}
                <Button size="sm" disabled={busy} onClick={() => void compare(b.file, () => extras.diffBackup(b.file))}>
                  <GitCompare size={14} /> {t("backups.compare")}
                </Button>
                <Button size="sm" disabled={busy || pending > 0} title={pending > 0 ? t("backups.pendingBody") : undefined} onClick={() => setRestoring(b.file)}>
                  <RotateCcw size={14} /> {t("backups.restore")}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {busy && <PokeballSpinner />}
      {diff && !busy && (
        <Card title={t("backups.diffTitle", { name: diff.title.split(/[\\/]/).pop() })} actions={<Button size="sm" variant="ghost" onClick={() => setDiff(null)}>{t("common.close")}</Button>}>
          <DiffView diff={diff.diff} />
        </Card>
      )}

      <ConfirmDialog
        open={!!restoring}
        danger
        title={t("backups.restoreTitle")}
        confirmLabel={t("backups.restore")}
        onConfirm={() => restoring && void restore(restoring)}
        onCancel={() => setRestoring(null)}
      >
        <p>{t("backups.restoreBody", { file: restoring ?? "" })}</p>
      </ConfirmDialog>
    </div>
  );
}
