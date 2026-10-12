import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { extras } from "../../api/extras";
import { useT } from "../../lib/useT";
import { toastError } from "../../stores/session";
import { useToasts } from "../../stores/toasts";
import { useUi } from "../../stores/ui";
import { Button, Modal, PokeballSpinner, Tabs } from "../../ui";
import styles from "./transfer.module.css";

type Fmt = "showdown" | "json";

/** Muestra el Pokemon en texto Showdown o JSON `peshex.pokemon/1` para copiarlo. */
export function ExportDialog() {
  const { t } = useT();
  const ref = useUi((s) => s.exportRef);
  const close = useUi((s) => s.setExportRef);
  const [fmt, setFmt] = useState<Fmt>("showdown");
  const [text, setText] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!ref) return;
    let live = true;
    setText(null);
    setCopied(false);
    extras
      .exportPokemon(ref, fmt)
      .then((r) => live && setText(r.format === "json" ? JSON.stringify(r.data, null, 2) : r.text))
      .catch((e) => {
        if (live) {
          toastError(e);
          close(null);
        }
      });
    return () => { live = false; };
  }, [ref, fmt, close]);

  async function copy() {
    if (text == null) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      useToasts.getState().push({ kind: "warning", text: t("transfer.copyFailed") });
    }
  }

  return (
    <Modal
      open={!!ref}
      title={t("transfer.exportTitle")}
      onClose={() => close(null)}
      footer={
        <>
          <Button variant="primary" disabled={text == null} onClick={() => void copy()}>
            {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? t("transfer.copied") : t("transfer.copy")}
          </Button>
          <Button onClick={() => close(null)}>{t("common.close")}</Button>
        </>
      }
    >
      <Tabs<Fmt> value={fmt} onChange={setFmt} tabs={[{ id: "showdown", label: t("transfer.showdown") }, { id: "json", label: "JSON" }]} />
      {text == null ? (
        <PokeballSpinner />
      ) : (
        <textarea className={styles.area} readOnly value={text} aria-label={t("transfer.exportText")} rows={14} onFocus={(e) => e.currentTarget.select()} />
      )}
      <p className="muted" style={{ fontSize: 12 }}>{fmt === "json" ? t("transfer.jsonHint") : t("transfer.showdownHint")}</p>
    </Modal>
  );
}
