import { History, Redo2, Undo2 } from "lucide-react";
import { semantic } from "../../api/semantic";
import { formatTime } from "../../lib/format";
import { useT } from "../../lib/useT";
import { useSession } from "../../stores/session";
import { Button, Card, EmptyState, PageTitle, PokeballSpinner } from "../../ui";
import shared from "../shared/shared.module.css";
import { useSemanticQuery } from "../queries";
import styles from "./changes.module.css";

/** Cambios pendientes: transacciones en orden inverso, con deshacer/rehacer. */
export function Changes() {
  const { t, dyn, locale } = useT();
  const undo = useSession((s) => s.undo);
  const redo = useSession((s) => s.redo);
  const undoAll = useSession((s) => s.undoAll);
  const pending = useSession((s) => s.pendingCount);
  const redoCount = useSession((s) => s.redoCount);
  const q = useSemanticQuery("history", semantic.history);

  if (!q.data) return <PokeballSpinner />;
  const txs = q.data.undo;

  return (
    <div className={shared.stack}>
      <PageTitle icon={<History />} title={t("changes.title")} />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Button disabled={pending === 0} onClick={() => void undo()}><Undo2 size={16} /> {t("changes.undoLast")}</Button>
        <Button disabled={redoCount === 0} onClick={() => void redo()}><Redo2 size={16} /> {t("changes.redoLast")}</Button>
        <Button variant="danger" disabled={pending === 0} onClick={() => void undoAll()}>{t("changes.undoAll")}</Button>
      </div>

      {txs.length === 0 ? (
        <Card><EmptyState>{t("changes.empty")}</EmptyState></Card>
      ) : (
        txs.map((tx) => (
          <Card key={tx.id} title={dyn(`changes.label.${tx.label.key}`, tx.label.params as Record<string, unknown>)}
            actions={<span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>{t("changes.at", { time: formatTime(tx.at, locale) })}</span>}>
            <table className={shared.extras}>
              <thead>
                <tr><th>{t("common.path")}</th><th>{t("changes.from")}</th><th>{t("changes.to")}</th></tr>
              </thead>
              <tbody>
                {tx.changes.map((c, i) => (
                  <tr key={i}>
                    <td className="mono" title={dyn(`changes.ops.${c.op}`, { path: c.path })}>{c.path}</td>
                    <td className={styles.old}>{c.old.display}</td>
                    <td className={styles.new}>{c.new.display}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        ))
      )}
    </div>
  );
}
