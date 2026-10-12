import { ChevronLeft, ChevronRight, Monitor } from "lucide-react";
import { useEffect, useState } from "react";
import { semantic } from "../../api/semantic";
import { displayName, genderSymbol } from "../../lib/pokemon";
import { useT } from "../../lib/useT";
import { useSession } from "../../stores/session";
import { Button, Chip, EmptyState, PageTitle, PokeballSpinner, SelectField, Sprite } from "../../ui";
import { useSemanticQuery } from "../queries";
import styles from "./boxes.module.css";

const COLUMNS = 6;

export function Boxes() {
  const { t, locale } = useT();
  const openEditor = useSession((s) => s.openEditor);
  const q = useSemanticQuery("storage", semantic.storage);
  const [box, setBox] = useState<number | null>(null);

  const storage = q.data;
  useEffect(() => {
    if (storage && box == null) setBox(storage.currentBox ?? 0);
  }, [storage, box]);

  if (q.isPending) return <PokeballSpinner />;
  if (!storage) return <EmptyState>{t("boxes.noStorage")}</EmptyState>;

  const index = Math.min(Math.max(box ?? 0, 0), storage.boxes.length - 1);
  const current = storage.boxes[index];
  const boxLabel = (b: { index: number; name: string | null; filled: number }) =>
    `${b.name || t("boxes.box", { n: b.index + 1 })} (${b.filled})`;

  return (
    <div>
      <PageTitle icon={<Monitor />} title={t("boxes.title")} subtitle={t("boxes.total", { count: storage.total })} />
      <div className={styles.toolbar}>
        <Button size="sm" icon variant="secondary" disabled={index <= 0} onClick={() => setBox(index - 1)} aria-label={t("common.previous")}>
          <ChevronLeft size={16} />
        </Button>
        <div style={{ minWidth: 240 }}>
          <SelectField
            value={index}
            ariaLabel={t("boxes.title")}
            options={storage.boxes.map((b) => ({ value: b.index, label: boxLabel(b) }))}
            onChange={(v) => setBox(v)}
          />
        </div>
        <Button size="sm" icon variant="secondary" disabled={index >= storage.boxes.length - 1} onClick={() => setBox(index + 1)} aria-label={t("common.next")}>
          <ChevronRight size={16} />
        </Button>
        {storage.currentBox === index && <Chip tone="accent">{t("boxes.current")}</Chip>}
        <Chip>{t("boxes.count", { count: current.filled })}</Chip>
      </div>

      <div className={styles.grid} style={{ gridTemplateColumns: `repeat(${COLUMNS}, minmax(0, 1fr))` }} role="grid" aria-label={current.name ?? ""} lang={locale}>
        {current.slots.map((p, i) =>
          p ? (
            <button key={i} type="button" className={styles.slot} onClick={() => openEditor(p.ref)} title={displayName(p)} aria-label={displayName(p)}>
              <Sprite name={displayName(p)} id={p.species?.id} size={44} shiny={p.shiny} egg={p.egg} />
              <span className={styles.slotName}>{p.egg ? t("party.egg") : displayName(p)}</span>
              <span className="muted" style={{ fontSize: 11 }}>
                {p.level != null ? t("party.level", { level: p.level }) : ""} {genderSymbol(p.gender)}
              </span>
            </button>
          ) : (
            <div key={i} className={styles.empty} aria-label={t("boxes.emptySlot")} />
          ),
        )}
      </div>
    </div>
  );
}
