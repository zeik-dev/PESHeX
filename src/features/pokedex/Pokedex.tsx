import { BookOpen, Eye, EyeOff } from "lucide-react";
import { useMemo, useState } from "react";
import { extras } from "../../api/extras";
import type { PokedexBulkMode } from "../../api/types";
import { prettyId } from "../../game/useCatalog";
import { norm } from "../../game/normalize";
import { useT } from "../../lib/useT";
import { useEdit } from "../../stores/edit";
import { useGame } from "../../stores/game";
import { useSession } from "../../stores/session";
import { Banner, Button, Card, Chip, EmptyState, PageTitle, PokeballSpinner, PokemonIcon, SelectField, Switch } from "../../ui";
import { useSemanticQuery } from "../queries";
import shared from "../shared/shared.module.css";
import styles from "./pokedex.module.css";

type Filter = "all" | "seen" | "owned" | "unseen" | "seenOnly";
const PAGE = 120;

interface Row {
  key: string;
  name: string;
  number: number | null;
  species: string;
  seen: boolean;
  owned: boolean;
  caught?: number;
}

export function Pokedex() {
  const { t, dyn } = useT();
  const apply = useEdit((s) => s.apply);
  const busy = useEdit((s) => s.busy);
  const editable = useSession((s) => s.profile?.editable ?? false);
  const catalog = useGame((s) => s.catalog);
  const q = useSemanticQuery("pokedex", extras.pokedex);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [shown, setShown] = useState(PAGE);

  const dex = q.data;
  const array = dex?.layout === "array";

  const rows: Row[] = useMemo(() => {
    if (!dex?.available) return [];
    const seen = new Set(dex.seen ?? []);
    const owned = new Set(dex.owned ?? []);
    const keyOf = (species: string, number: number | null) => (array ? (number != null ? String(number) : species) : species);
    const out = new Map<string, Row>();
    // Con catalogo: TODAS las especies del juego (para poder marcar las que faltan). Sin el, solo las que el save menciona.
    for (const s of catalog?.species ?? []) {
      if (s.form !== 0) continue;
      const key = keyOf(s.species, s.number);
      out.set(key, { key, name: s.name ?? prettyId(s.species), number: s.number, species: s.species, seen: seen.has(key), owned: owned.has(key), caught: dex.caught?.[key] });
    }
    for (const id of dex.ids ?? []) {
      if (out.has(id)) continue;
      out.set(id, { key: id, name: array ? `#${id}` : prettyId(id), number: array ? Number(id) : null, species: id, seen: seen.has(id), owned: owned.has(id), caught: dex.caught?.[id] });
    }
    const list = [...out.values()];
    list.sort((a, b) => (a.number ?? 1e9) - (b.number ?? 1e9) || a.name.localeCompare(b.name));
    return list;
  }, [dex, catalog, array]);

  const counts = useMemo(() => ({ seen: rows.filter((r) => r.seen).length, owned: rows.filter((r) => r.owned).length, total: rows.length }), [rows]);

  const filtered = useMemo(() => {
    const needle = norm(search);
    return rows.filter((r) => {
      if (needle && !norm(r.name).includes(needle) && !norm(r.species).includes(needle) && String(r.number ?? "") !== search.trim()) return false;
      switch (filter) {
        case "seen": return r.seen;
        case "owned": return r.owned;
        case "unseen": return !r.seen;
        case "seenOnly": return r.seen && !r.owned;
        default: return true;
      }
    });
  }, [rows, search, filter]);

  if (q.isPending) return <PokeballSpinner />;
  if (!dex?.available) return <EmptyState>{t("pokedex.none")}</EmptyState>;

  const off = !editable || busy;
  const bulk = (mode: PokedexBulkMode) => {
    const ids = filtered.map((r) => r.key);
    if (ids.length) void apply([{ op: "pokedex.bulk", mode, ids }]);
  };

  return (
    <div className={shared.stack}>
      <PageTitle icon={<BookOpen />} title={t("pokedex.title")} subtitle={t("pokedex.counts", { seen: counts.seen, owned: counts.owned, total: counts.total })} />
      {!catalog && <Banner tone="info" title={t("pokedex.noCatalogTitle")}>{t("pokedex.noCatalog")}</Banner>}

      <Card>
        <div className={styles.toolbar}>
          <input className={styles.search} aria-label={t("pokedex.search")} placeholder={t("pokedex.search")} value={search}
            onChange={(e) => { setSearch(e.target.value); setShown(PAGE); }} />
          <SelectField<Filter> ariaLabel={t("pokedex.filter")} value={filter} onChange={(f) => { setFilter(f); setShown(PAGE); }}
            options={(["all", "seen", "owned", "unseen", "seenOnly"] as Filter[]).map((f) => ({ value: f, label: dyn(`pokedex.filters.${f}`) }))} />
          <Chip tone="info">{t("pokedex.shown", { count: filtered.length })}</Chip>
        </div>
        <div className={styles.bulk} role="group" aria-label={t("pokedex.bulkTitle")}>
          <span className="muted">{t("pokedex.bulkOn", { count: filtered.length })}</span>
          <Button size="sm" disabled={off || filtered.length === 0} onClick={() => bulk("seen_all")}><Eye size={14} /> {t("pokedex.markSeen")}</Button>
          <Button size="sm" disabled={off || filtered.length === 0} onClick={() => bulk("owned_all")}>{t("pokedex.markOwned")}</Button>
          <Button size="sm" disabled={off || filtered.length === 0} onClick={() => bulk("unown_all")}>{t("pokedex.unmarkOwned")}</Button>
          <Button size="sm" variant="ghost" disabled={off || filtered.length === 0} onClick={() => bulk("clear_all")}><EyeOff size={14} /> {t("pokedex.clear")}</Button>
        </div>

        {filtered.length === 0 ? (
          <EmptyState>{t("pokedex.noMatches")}</EmptyState>
        ) : (
          <ul className={styles.list} aria-label={t("pokedex.title")}>
            {filtered.slice(0, shown).map((r) => (
              <li key={r.key} className={styles.row} data-seen={r.seen} data-owned={r.owned}>
                <span className={styles.icon}>
                  <PokemonIcon name={r.name} species={r.species} number={r.number ?? undefined} size={40} />
                </span>
                <span className={styles.num}>{r.number != null ? String(r.number).padStart(3, "0") : ""}</span>
                <span className={styles.name}>{r.seen ? r.name : <span className="muted">{r.name}</span>}</span>
                {r.caught != null && r.caught > 0 && <span className="muted mono" style={{ fontSize: 11 }}>×{r.caught}</span>}
                <label className={styles.toggle}>
                  <Switch checked={r.seen} disabled={off} label={`${r.name} — ${t("pokedex.seen")}`}
                    onChange={(v) => void apply([{ op: "pokedex.set", id: r.key, seen: v }])} />
                  <span>{t("pokedex.seen")}</span>
                </label>
                <label className={styles.toggle}>
                  <Switch checked={r.owned} disabled={off} label={`${r.name} — ${t("pokedex.owned")}`}
                    onChange={(v) => void apply([{ op: "pokedex.set", id: r.key, owned: v }])} />
                  <span>{t("pokedex.owned")}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
        {filtered.length > shown && (
          <div style={{ textAlign: "center", marginTop: 12 }}>
            <Button onClick={() => setShown((n) => n + PAGE)}>{t("pokedex.more", { count: filtered.length - shown })}</Button>
          </div>
        )}
      </Card>
    </div>
  );
}
