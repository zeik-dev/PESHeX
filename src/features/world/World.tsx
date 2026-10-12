import { Globe2 } from "lucide-react";
import { useEffect, useState } from "react";
import { extras } from "../../api/extras";
import type { HallOfFameView, StatEntry, StatsView, WorldKind, WorldPage, WorldRow } from "../../api/types";
import { formatDuration } from "../../lib/format";
import { displayName } from "../../lib/pokemon";
import { useT } from "../../lib/useT";
import { useEdit } from "../../stores/edit";
import { useSession } from "../../stores/session";
import { useUi } from "../../stores/ui";
import { Banner, Button, Card, Chip, EmptyState, NumberField, PageTitle, PokeballSpinner, PokemonIcon, Switch, Tabs, TextField } from "../../ui";
import { useSemanticQuery } from "../queries";
import shared from "../shared/shared.module.css";
import styles from "./world.module.css";

type Tab = WorldKind | "stats" | "hof";
const PAGE_SIZE = 100;

export function World() {
  const { t } = useT();
  const target = useUi((s) => s.worldTarget);
  const setTarget = useUi((s) => s.setWorldTarget);
  const [tab, setTab] = useState<Tab>("switches");
  const [q, setQ] = useState("");

  // Llegada desde la busqueda global: abre la pestana y el texto buscado.
  useEffect(() => {
    if (target) {
      setTab(target.kind);
      setQ(target.q);
      setTarget(null);
    }
  }, [target, setTarget]);

  return (
    <div className={shared.stack}>
      <PageTitle icon={<Globe2 />} title={t("world.title")} subtitle={t("world.subtitle")} />
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "switches", label: t("world.switches") },
          { id: "variables", label: t("world.variables") },
          { id: "stats", label: t("world.stats") },
          { id: "hof", label: t("world.hof") },
        ]}
      />
      {(tab === "switches" || tab === "variables") && <WorldTable key={tab} kind={tab} q={q} setQ={setQ} />}
      {tab === "stats" && <StatsPanel />}
      {tab === "hof" && <HallOfFame />}
    </div>
  );
}

function WorldTable({ kind, q, setQ }: { kind: WorldKind; q: string; setQ: (q: string) => void }) {
  const { t } = useT();
  const apply = useEdit((s) => s.apply);
  const busy = useEdit((s) => s.busy);
  const editable = useSession((s) => s.profile?.editable ?? false);
  const [page, setPage] = useState(0);
  const [onlyNonDefault, setOnlyNonDefault] = useState(false);
  const [debounced, setDebounced] = useState(q);
  useEffect(() => {
    const h = setTimeout(() => setDebounced(q), 200);
    return () => clearTimeout(h);
  }, [q]);

  const query = useSemanticQuery<WorldPage>(
    ["world", kind, debounced, page, onlyNonDefault],
    () => extras.world({ kind, q: debounced, page, pageSize: PAGE_SIZE, onlyNonDefault }),
  );
  const data = query.data;
  if (query.isPending) return <PokeballSpinner />;
  if (!data?.available) return <EmptyState>{t("world.none")}</EmptyState>;
  const pages = Math.max(1, Math.ceil((data.total ?? 0) / PAGE_SIZE));
  const off = !editable || busy;

  return (
    <Card>
      {!data.named && <Banner tone="info" title={t("world.noNamesTitle")}>{t("world.noNames")}</Banner>}
      <div className={styles.toolbar}>
        <input className={styles.search} aria-label={t("world.search")} placeholder={t("world.search")} value={q}
          onChange={(e) => { setQ(e.target.value); setPage(0); }} />
        <label className={styles.inline}>
          <Switch checked={onlyNonDefault} onChange={(v) => { setOnlyNonDefault(v); setPage(0); }} label={t("world.onlyNonDefault")} />
          {kind === "switches" ? t("world.onlyOn") : t("world.onlyNonDefault")}
        </label>
        <Chip tone="info">{t("world.total", { count: data.total ?? 0 })}</Chip>
      </div>
      {(data.rows ?? []).length === 0 ? (
        <EmptyState>{t("world.noMatches")}</EmptyState>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr><th>ID</th><th>{t("world.name")}</th><th>{t("world.value")}</th></tr>
          </thead>
          <tbody>
            {data.rows!.map((r) => (
              <tr key={r.id}>
                <td className="mono">{String(r.id).padStart(4, "0")}</td>
                <td>{r.name ?? <span className="muted">—</span>}</td>
                <td>
                  {kind === "switches" ? (
                    <Switch checked={r.value.value === true} disabled={off} label={`${r.name ?? r.id}`}
                      onChange={(v) => void apply([{ op: "world.switch", id: r.id, value: v }])} />
                  ) : (
                    <VariableCell row={r} disabled={off} onCommit={(value) => void apply([{ op: "world.variable", id: r.id, value }])} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {pages > 1 && (
        <div className={styles.pager}>
          <Button size="sm" disabled={page <= 0} onClick={() => setPage(page - 1)}>{t("world.prev")}</Button>
          <span className="muted">{t("world.page", { page: page + 1, pages })}</span>
          <Button size="sm" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>{t("world.next")}</Button>
        </div>
      )}
    </Card>
  );
}

function VariableCell({ row, disabled, onCommit }: { row: WorldRow; disabled: boolean; onCommit: (v: number | string) => void }) {
  const { t } = useT();
  const label = `${row.name ?? row.id}`;
  const v = row.value;
  if (v.kind === "int" || v.kind === "nil") {
    return <NumberField value={typeof v.value === "number" ? v.value : null} disabled={disabled} width={140} ariaLabel={label} onCommit={onCommit} />;
  }
  if (v.kind === "str") {
    return <TextField value={String(v.value ?? "")} disabled={disabled} ariaLabel={label} onCommit={(s) => onCommit(s ?? "")} />;
  }
  return <span className="mono muted" title={t("world.readOnly")}>{v.display}</span>;
}

const GROUPS = ["battle", "money", "travel", "pokemon", "time", "other"] as const;

function StatsPanel() {
  const { t, dyn } = useT();
  const q = useSemanticQuery<StatsView>("stats", extras.stats);
  if (q.isPending) return <PokeballSpinner />;
  const s = q.data;
  if (!s?.available) return <EmptyState>{t("world.statsNone")}</EmptyState>;
  const byGroup = new Map<string, StatEntry[]>();
  for (const e of s.entries ?? []) byGroup.set(e.group, [...(byGroup.get(e.group) ?? []), e]);
  return (
    <div className={shared.stack}>
      {s.playTime != null && <Chip tone="accent">{t("world.playTime", { time: formatDuration(s.playTime) })}</Chip>}
      {GROUPS.filter((g) => byGroup.has(g)).map((g) => (
        <Card key={g} title={dyn(`world.group.${g}`)}>
          <dl className={shared.kv}>
            {byGroup.get(g)!.map((e) => (
              <div key={e.name} style={{ display: "contents" }}>
                <dt className={shared.kvLabel}>{e.name.replace(/_/g, " ")}</dt>
                <dd className={shared.kvValue} style={{ margin: 0 }}>{e.value.display}</dd>
              </div>
            ))}
          </dl>
        </Card>
      ))}
    </div>
  );
}

function HallOfFame() {
  const { t } = useT();
  const q = useSemanticQuery<HallOfFameView>("hof", extras.hallOfFame);
  if (q.isPending) return <PokeballSpinner />;
  const h = q.data;
  if (!h?.available || (h.entries ?? []).length === 0) return <EmptyState>{t("world.hofNone")}</EmptyState>;
  return (
    <div className={shared.stack}>
      {h.entries!.map((e) => (
        <Card key={e.index} title={t("world.hofEntry", { n: e.index + 1 })}>
          {e.members.length === 0 ? (
            <span className="muted mono">{e.display}</span>
          ) : (
            <ul className={styles.hof}>
              {e.members.map((m) => (
                <li key={m.ref}>
                  <PokemonIcon name={displayName(m)} species={m.species?.id ?? 0} form={m.form} gender={m.gender} shiny={m.shiny} size={48} />
                  <span>{displayName(m)}</span>
                  {m.level != null && <span className="muted">{t("party.level", { level: m.level })}</span>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      ))}
    </div>
  );
}
