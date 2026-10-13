import { ArrowRightLeft, Backpack, Plus, Star, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { semantic } from "../../api/semantic";
import type { BagPocket } from "../../api/types";
import { catEntry, itemDisplayName } from "../../game/lookup";
import { useT } from "../../lib/useT";
import { useEdit } from "../../stores/edit";
import { useGame } from "../../stores/game";
import { useSession } from "../../stores/session";
import { Button, Card, Chip, EmptyState, Field, ItemIcon, NumberField, PageTitle, PokeballSpinner, Tabs } from "../../ui";
import { ExtrasList } from "../shared/ExtrasList";
import { ItemPicker } from "../shared/ItemPicker";
import shared from "../shared/shared.module.css";
import { useSemanticQuery } from "../queries";
import styles from "./bag.module.css";

export function Bag() {
  const { t, dynOr } = useT();
  const apply = useEdit((s) => s.apply);
  const profile = useSession((s) => s.profile);
  const catalog = useGame((s) => s.catalogIndex);
  const q = useSemanticQuery("bag", semantic.bag);
  const [pocketIdx, setPocketIdx] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [newId, setNewId] = useState<string | null>(null);
  const [newQty, setNewQty] = useState(1);

  const bag = q.data;
  useEffect(() => {
    if (bag && (pocketIdx == null || !bag.pockets.some((p) => p.index === pocketIdx))) {
      setPocketIdx((bag.pockets.find((p) => p.count > 0) ?? bag.pockets[0])?.index ?? null);
    }
  }, [bag, pocketIdx]);

  const pocket: BagPocket | undefined = bag?.pockets.find((p) => p.index === pocketIdx);
  const needle = search.trim().toLowerCase();
  const slots = useMemo(
    () => (pocket?.slots ?? []).filter((s) => !needle || s.name.toLowerCase().includes(needle) || String(s.id).toLowerCase().includes(needle)),
    [pocket, needle],
  );

  if (q.isPending) return <PokeballSpinner />;
  if (!bag) return <EmptyState>{t("bag.noBag")}</EmptyState>;

  const editable = profile?.editable ?? false;
  const max = bag.limits.bagPerSlot;
  const pocketName = (p: BagPocket) =>
    p.key ? dynOr("pocket", p.key, p.key) : bag.layout === "flat" ? t("pocket.all") : t("pocket.generic", { n: p.index });
  const pocketsByIndex = new Map(bag.pockets.map((p) => [p.index, p]));
  // El bolsillo real de un objeto lo dice el juego (items.txt): los del motor van de 1 a 8 y coinciden con el indice del save.
  const realPocket = (id: string | number): BagPocket | undefined => {
    if (bag.layout === "flat") return undefined;
    const n = catEntry(catalog, "items", id)?.pocket;
    return n != null ? pocketsByIndex.get(n) : undefined;
  };

  const target = newId ? (realPocket(newId) ?? pocket) : pocket;

  async function add() {
    if (!target || !newId?.trim()) return;
    const r = await apply([{ op: "bag.set", pocket: target.index, id: newId.trim().toUpperCase(), qty: newQty }]);
    if (r?.applied) {
      setPocketIdx(target.index); // se enseña donde ha quedado
      setSearch("");
      setNewId(null);
      setNewQty(1);
    }
  }

  async function moveToRealPocket(slotRef: string, id: string | number, qty: number, to: BagPocket) {
    const internal = catEntry(catalog, "items", id)?.id ?? String(id);
    const r = await apply([
      { op: "bag.set", ref: slotRef, qty: 0 },
      { op: "bag.set", pocket: to.index, id: internal, qty },
    ]);
    if (r?.applied) setPocketIdx(to.index);
  }

  return (
    <div className={shared.stack}>
      <PageTitle icon={<Backpack />} title={t("bag.title")} />

      <Card title={t("bag.addTitle")}>
        <div className={styles.addRow}>
          <div className={styles.addPicker}>
            <Field label={t("bag.itemId")}>
              {(id) => (
                <ItemPicker id={id} value={newId} onChange={setNewId} placeholder={t("bag.itemIdPlaceholder")} disabled={!editable} />
              )}
            </Field>
          </div>
          <Field label={t("bag.qty")}>
            {(id) => <NumberField id={id} value={newQty} min={1} max={max} width={100} disabled={!editable} onCommit={setNewQty} />}
          </Field>
          <Button variant="primary" disabled={!editable || !newId?.trim() || !target} onClick={() => void add()}>
            <Plus size={16} /> {t("bag.add")}
          </Button>
        </div>
        <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
          {newId && target ? t("bag.target", { pocket: pocketName(target) }) : catalog ? t("bag.hintPocket") : t("bag.hint")}
        </p>
      </Card>

      <Tabs
        value={String(pocketIdx ?? "")}
        onChange={(v) => { setPocketIdx(Number(v)); setSearch(""); }}
        tabs={bag.pockets.map((p) => ({ id: String(p.index), label: pocketName(p), badge: p.count }))}
      />

      <Card>
        <div className={styles.toolbar}>
          <input
            className={styles.search}
            placeholder={t("bag.search")}
            aria-label={t("bag.search")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <span className="muted" style={{ fontSize: 12 }}>
            {t("bag.total", { count: bag.totalItems })} · {t("bag.max", { max })}
          </span>
        </div>

        {!pocket || pocket.slots.length === 0 ? (
          <EmptyState>{t("bag.empty")}</EmptyState>
        ) : slots.length === 0 ? (
          <EmptyState>{t("bag.noMatches")}</EmptyState>
        ) : (
          <ul className={styles.list}>
            {slots.map((s) => {
              const entry = catEntry(catalog, "items", s.id);
              const name = entry ? itemDisplayName(entry, catalog, s.name) : s.name;
              const home = realPocket(s.id);
              const elsewhere = home && home.index !== pocket.index ? home : null;
              return (
                <li key={s.ref} className={styles.item}>
                  <span className={styles.itemIcon} aria-hidden="true">
                    <ItemIcon item={{ id: s.id }} size={28} />
                    <span className={styles.itemLetter}>{name.trim()[0]?.toUpperCase() ?? "?"}</span>
                  </span>
                  <div className={styles.itemName}>
                    <strong>{name}</strong>
                    <span className="muted mono" style={{ fontSize: 11 }}>{String(entry?.id ?? s.id)}</span>
                  </div>
                  {elsewhere && (
                    <Chip tone="info" title={t("bag.otherPocketHint", { pocket: pocketName(elsewhere) })}>
                      {t("bag.otherPocket", { pocket: pocketName(elsewhere) })}
                    </Chip>
                  )}
                  {elsewhere && (
                    <Button variant="ghost" size="sm" disabled={!editable} onClick={() => void moveToRealPocket(s.ref, s.id, s.qty, elsewhere)}>
                      <ArrowRightLeft size={14} /> {t("bag.moveTo", { pocket: pocketName(elsewhere) })}
                    </Button>
                  )}
                  {s.favourite && <Chip tone="warn"><Star size={12} /> {t("bag.favourite")}</Chip>}
                  {s.registered && <Chip tone="info">{t("bag.registered")}</Chip>}
                  <NumberField value={s.qty} min={1} max={max} width={92} disabled={!editable} ariaLabel={`${name} — ${t("bag.qty")}`}
                    onCommit={(n) => void apply([{ op: "bag.set", ref: s.ref, qty: n }])} />
                  <Button variant="ghost" size="sm" icon disabled={!editable} aria-label={t("bag.remove")} title={t("bag.remove")}
                    onClick={() => void apply([{ op: "bag.set", ref: s.ref, qty: 0 }])}>
                    <Trash2 size={16} />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {bag.extras.length > 0 && (
        <Card title={t("bag.extras")}>
          <ExtrasList ref_="bag" extras={bag.extras} readOnly={!editable} />
        </Card>
      )}
    </div>
  );
}
