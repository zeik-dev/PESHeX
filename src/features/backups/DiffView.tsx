import type { DiffMon, FieldDiff, SaveDiff } from "../../api/types";
import { useT } from "../../lib/useT";
import { Card, Chip } from "../../ui";
import shared from "../shared/shared.module.css";
import styles from "./backups.module.css";

export function fmtValue(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "boolean") return v ? "✔" : "✘";
  if (Array.isArray(v)) return v.map(fmtValue).join(", ") || "—";
  if (typeof v === "object") {
    return Object.entries(v as Record<string, unknown>).map(([k, x]) => `${k}: ${fmtValue(x)}`).join(" · ");
  }
  return String(v);
}

function monLabel(m: DiffMon): string {
  return [m.nickname || m.species || "???", m.level != null ? `Nv. ${m.level}` : null].filter(Boolean).join(" · ");
}

function FieldRows({ rows, prefix }: { rows: FieldDiff[]; prefix: "trainer" | "pokemon" }) {
  const { t, dyn } = useT();
  return (
    <table className={shared.extras}>
      <thead>
        <tr><th>{t("diff.field")}</th><th>{t("diff.current")}</th><th>{t("diff.other")}</th></tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.field}>
            <td>{dyn(`diff.fields.${prefix}.${r.field}`, { defaultValue: r.field })}</td>
            <td className={styles.cur}>{fmtValue(r.a)}</td>
            <td className={styles.oth}>{fmtValue(r.b)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Comparacion semantica entre la partida abierta (con sus cambios pendientes) y otra. */
export function DiffView({ diff }: { diff: SaveDiff }) {
  const { t } = useT();
  const s = diff.summary;
  const total = s.trainer + s.bag + s.pokemonAdded + s.pokemonRemoved + s.pokemonChanged + s.pokemonMoved + s.pokedex + s.world;
  const mons = diff.pokemon;
  const dex = diff.pokedex;

  return (
    <div className={shared.stack} data-testid="diff-view">
      <div className={styles.summary}>
        <Chip tone={total === 0 ? "good" : "accent"}>{total === 0 ? t("diff.identical") : t("diff.differences", { count: total })}</Chip>
        {s.trainer > 0 && <Chip>{t("diff.sumTrainer", { count: s.trainer })}</Chip>}
        {s.bag > 0 && <Chip>{t("diff.sumBag", { count: s.bag })}</Chip>}
        {s.pokemonAdded > 0 && <Chip tone="good">+{s.pokemonAdded}</Chip>}
        {s.pokemonRemoved > 0 && <Chip tone="bad">−{s.pokemonRemoved}</Chip>}
        {s.pokemonChanged > 0 && <Chip tone="warn">{t("diff.sumChanged", { count: s.pokemonChanged })}</Chip>}
        {s.pokedex > 0 && <Chip>{t("diff.sumDex", { count: s.pokedex })}</Chip>}
        {s.world > 0 && <Chip>{t("diff.sumWorld", { count: s.world })}</Chip>}
      </div>
      <p className="muted" style={{ fontSize: 12 }}>{t("diff.note", { current: mons.totals.current, other: mons.totals.other })}</p>

      {diff.trainer.length > 0 && <Card title={t("diff.trainer")}><FieldRows rows={diff.trainer} prefix="trainer" /></Card>}

      {diff.bag.length > 0 && (
        <Card title={t("diff.bag")}>
          <table className={shared.extras}>
            <thead><tr><th>{t("diff.item")}</th><th>{t("diff.current")}</th><th>{t("diff.other")}</th></tr></thead>
            <tbody>
              {diff.bag.map((b) => (
                <tr key={b.id}>
                  <td>{b.name ?? b.id}</td>
                  <td className={styles.cur}>{b.a ?? 0}</td>
                  <td className={styles.oth}>{b.b ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {mons.added.length > 0 && (
        <Card title={t("diff.onlyCurrent")}>
          <ul className={shared.list}>{mons.added.map((m) => <li key={m.ref}>{monLabel(m)} <span className="muted mono">{m.ref}</span></li>)}</ul>
        </Card>
      )}
      {mons.removed.length > 0 && (
        <Card title={t("diff.onlyOther")}>
          <ul className={shared.list}>{mons.removed.map((m) => <li key={m.ref}>{monLabel(m)} <span className="muted mono">{m.ref}</span></li>)}</ul>
        </Card>
      )}
      {mons.changed.map((m) => (
        <Card key={m.ref + m.against} title={t("diff.changedMon", { name: monLabel(m) })}>
          <FieldRows rows={m.diffs} prefix="pokemon" />
        </Card>
      ))}
      {mons.moved.length > 0 && (
        <Card title={t("diff.moved")}>
          <ul className={shared.list}>{mons.moved.map((m) => <li key={m.ref}>{monLabel(m)}: <span className="mono">{m.from} → {m.ref}</span></li>)}</ul>
        </Card>
      )}

      {s.pokedex > 0 && (
        <Card title={t("diff.pokedex")}>
          <ul className={shared.list}>
            {dex.seenAdded.length > 0 && <li>{t("diff.dexSeenAdded", { count: dex.seenAdded.length })}: <span className="mono">{dex.seenAdded.slice(0, 12).join(", ")}</span></li>}
            {dex.seenRemoved.length > 0 && <li>{t("diff.dexSeenRemoved", { count: dex.seenRemoved.length })}: <span className="mono">{dex.seenRemoved.slice(0, 12).join(", ")}</span></li>}
            {dex.ownedAdded.length > 0 && <li>{t("diff.dexOwnedAdded", { count: dex.ownedAdded.length })}: <span className="mono">{dex.ownedAdded.slice(0, 12).join(", ")}</span></li>}
            {dex.ownedRemoved.length > 0 && <li>{t("diff.dexOwnedRemoved", { count: dex.ownedRemoved.length })}: <span className="mono">{dex.ownedRemoved.slice(0, 12).join(", ")}</span></li>}
          </ul>
        </Card>
      )}

      {(["switches", "variables"] as const).filter((k) => diff.world[k].changed > 0).map((k) => (
        <Card key={k} title={t(`diff.world.${k}`, { count: diff.world[k].changed })}>
          <table className={shared.extras}>
            <thead><tr><th>ID</th><th>{t("world.name")}</th><th>{t("diff.current")}</th><th>{t("diff.other")}</th></tr></thead>
            <tbody>
              {diff.world[k].sample.map((w) => (
                <tr key={w.id}>
                  <td className="mono">{w.id}</td>
                  <td>{w.name ?? "—"}</td>
                  <td className={styles.cur}>{w.a}</td>
                  <td className={styles.oth}>{w.b}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ))}
    </div>
  );
}
