import { useMemo, useRef, useState } from "react";
import type { PokemonImport } from "../../api/types";
import {
  catalogResolver, GUESS_RESOLVER, parsePokemonJson, parseShowdown, resolveSet, type ImportWarning,
} from "../../lib/showdown";
import { prettyId } from "../../game/useCatalog";
import { useT } from "../../lib/useT";
import { useEdit } from "../../stores/edit";
import { useGame } from "../../stores/game";
import { useToasts } from "../../stores/toasts";
import { useUi } from "../../stores/ui";
import { Button, Modal, PokemonIcon } from "../../ui";
import styles from "./transfer.module.css";

interface Entry {
  data: PokemonImport | null;
  label: string;
  error?: string;
  warnings: ImportWarning[];
}

/** Importar Pokemon desde texto Showdown (uno o varios) o desde un JSON exportado por PESHeX. */
export function ImportDialog() {
  const { t, dyn } = useT();
  const open = useUi((s) => s.importOpen);
  const setOpen = useUi((s) => s.setImportOpen);
  const apply = useEdit((s) => s.apply);
  const busy = useEdit((s) => s.busy);
  const catalog = useGame((s) => s.catalog);
  const [text, setText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const entries: Entry[] = useMemo(() => {
    const src = text.trim();
    if (!src) return [];
    if (src.startsWith("{")) {
      const r = parsePokemonJson(src);
      if (!r.ok) return [{ data: null, label: "JSON", error: r.reason, warnings: [] }];
      return [{ data: r.data, label: prettyId(r.data.species), warnings: [] }];
    }
    const resolver = catalog ? catalogResolver(catalog) : GUESS_RESOLVER;
    return parseShowdown(src).map((set) => {
      const r = resolveSet(set, resolver);
      return { data: r.data, label: set.nickname ? `${set.nickname} (${set.species})` : set.species, error: r.data ? undefined : "unknown_species", warnings: r.warnings };
    });
  }, [text, catalog]);

  const valid = entries.filter((e) => e.data);

  function close() {
    setOpen(false);
    setText("");
  }

  async function run() {
    const r = await apply(valid.map((e) => ({ op: "pokemon.add" as const, to: "auto", data: e.data! })));
    if (r?.applied) {
      useToasts.getState().push({ kind: "success", text: t("transfer.imported", { count: valid.length }) });
      close();
    }
  }

  async function readFile(f: File | undefined) {
    if (f) setText(await f.text());
  }

  return (
    <Modal
      open={open}
      title={t("transfer.importTitle")}
      onClose={close}
      footer={
        <>
          <Button variant="primary" disabled={valid.length === 0 || busy} onClick={() => void run()}>
            {t("transfer.importAction", { count: valid.length })}
          </Button>
          <Button onClick={close}>{t("common.cancel")}</Button>
        </>
      }
    >
      <p className="muted">{t("transfer.importHelp")}</p>
      <textarea
        className={styles.area}
        value={text}
        rows={10}
        spellCheck={false}
        aria-label={t("transfer.importText")}
        placeholder={t("transfer.importPlaceholder")}
        onChange={(e) => setText(e.target.value)}
      />
      <div style={{ marginTop: 8 }}>
        <input ref={fileRef} type="file" accept=".json,.txt,text/plain,application/json" hidden onChange={(e) => void readFile(e.target.files?.[0])} />
        <Button size="sm" onClick={() => fileRef.current?.click()}>{t("transfer.pickFile")}</Button>
      </div>
      {entries.length > 0 && (
        <ul className={styles.preview} aria-label={t("transfer.preview")}>
          {entries.map((e, i) => (
            <li key={i} className={styles.previewItem} data-bad={!e.data}>
              {e.data && <PokemonIcon name={e.label} species={e.data.species} form={e.data.form ?? 0} size={40} />}
              <div style={{ minWidth: 0 }}>
                <strong>{e.label}</strong>
                {e.data?.level != null && <span className="muted"> · {t("party.level", { level: e.data.level })}</span>}
                {e.error && <div style={{ color: "var(--bad, #c0392b)", fontSize: 13 }}>{dyn(`transfer.error.${e.error}`)}</div>}
                {e.warnings.length > 0 && (
                  <ul className={styles.warnList}>
                    {e.warnings.map((w, j) => <li key={j}>{dyn(`transfer.warn.${w.code}`, { name: w.name })}</li>)}
                  </ul>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
