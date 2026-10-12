import { Backpack, Plus, Star, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { semantic } from "../../api/semantic";
import type { BagPocket } from "../../api/types";
import { useT } from "../../lib/useT";
import { useEdit } from "../../stores/edit";
import { useSession } from "../../stores/session";
import { Button, Card, Chip, EmptyState, Field, NumberField, PageTitle, PokeballSpinner, Tabs } from "../../ui";
import { ExtrasList } from "../shared/ExtrasList";
import shared from "../shared/shared.module.css";
import { useSemanticQuery } from "../queries";
import styles from "./bag.module.css";

export function Bag() {
  const { t, dynOr } = useT();
  const apply = useEdit((s) => s.apply);
  const profile = useSession((s) => s.profile);
  const q = useSemanticQuery("bag", semantic.bag);
  const [pocketIdx, setPocketIdx] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [newId, setNewId] = useState("");
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

  async function add() {
    if (!pocket || !newId.trim()) return;
    const r = await apply([{ op: "bag.set", pocket: pocket.index, id: newId.trim().toUpperCase(), qty: newQty }]);
    if (r?.applied) {
      setNewId("");
      setNewQty(1);
    }
  }

  return (
    <div className={shared.stack}>
      <PageTitle icon={<Backpack />} title={t("bag.title")} subtitle={t("bag.total", { count: bag.totalItems })} />
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
          <span className="muted" style={{ fontSize: 12 }}>{t("bag.max", { max })}</span>
        </div>

        {!pocket || pocket.slots.length === 0 ? (
          <EmptyState>{t("bag.empty")}</EmptyState>
        ) : slots.length === 0 ? (
          <EmptyState>{t("bag.noMatches")}</EmptyState>
        ) : (
          <ul className={styles.list}>
            {slots.map((s) => (
              <li key={s.ref} className={styles.item}>
                <span className={styles.itemIcon} aria-hidden="true">{s.name.trim()[0]?.toUpperCase() ?? "?"}</span>
                <div className={styles.itemName}>
                  <strong>{s.name}</strong>
                  <span className="muted mono" style={{ fontSize: 11 }}>{String(s.id)}</span>
                </div>
                {s.favourite && <Chip tone="warn"><Star size={12} /> {t("bag.favourite")}</Chip>}
                {s.registered && <Chip tone="info">{t("bag.registered")}</Chip>}
                <NumberField value={s.qty} min={1} max={max} width={92} disabled={!editable} ariaLabel={`${s.name} — ${t("bag.qty")}`}
                  onCommit={(n) => void apply([{ op: "bag.set", ref: s.ref, qty: n }])} />
                <Button variant="ghost" size="sm" icon disabled={!editable} aria-label={t("bag.remove")} title={t("bag.remove")}
                  onClick={() => void apply([{ op: "bag.set", ref: s.ref, qty: 0 }])}>
                  <Trash2 size={16} />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {pocket && (
        <Card title={t("bag.addTitle")}>
          <div className={styles.addRow}>
            <Field label={t("bag.itemId")}>
              {(id) => (
                <input id={id} className={styles.search + " mono"} value={newId} placeholder={t("bag.itemIdPlaceholder")}
                  disabled={!editable} onChange={(e) => setNewId(e.target.value.toUpperCase())}
                  onKeyDown={(e) => e.key === "Enter" && void add()} />
              )}
            </Field>
            <Field label={t("bag.qty")}>
              {(id) => <NumberField id={id} value={newQty} min={1} max={max} width={100} disabled={!editable} onCommit={setNewQty} />}
            </Field>
            <Button variant="primary" disabled={!editable || !newId.trim()} onClick={() => void add()}>
              <Plus size={16} /> {t("bag.add")}
            </Button>
          </div>
          <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>{t("bag.hint")}</p>
        </Card>
      )}

      {bag.extras.length > 0 && (
        <Card title={t("bag.extras")}>
          <ExtrasList ref_="bag" extras={bag.extras} readOnly={!editable} />
        </Card>
      )}
    </div>
  );
}
