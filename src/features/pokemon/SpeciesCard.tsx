import { useMemo } from "react";
import { STAT_IDS, type PokemonDetail, type StatId } from "../../api/types";
import { speciesEntry } from "../../game/lookup";
import type { SpeciesDetail } from "../../game/types";
import { baseStatTotal, type StatBreakdown } from "../../lib/stats";
import { displayName, genderSymbol } from "../../lib/pokemon";
import { useT } from "../../lib/useT";
import { useGame } from "../../stores/game";
import { useSettings } from "../../stores/settings";
import { Chip, PokemonIcon, Segmented, StackedStatBar, StatBar, TypeChip, type StatSegment } from "../../ui";
import { useStatMath } from "./useStatMath";
import styles from "./pokemon.module.css";

/** Colores de cada factor en la vista «Estadísticas actuales»: base+nivel rojo, IV azul, EV naranja, naturaleza verde. */
const PART_COLORS = {
  base: "var(--danger)",
  iv: "var(--info)",
  ev: "var(--stat-ev)",
  nature: "var(--success)",
} as const;

/** Cabecera de la hoja: sprite, nombre, tipos y las estadísticas de la especie en ESTE juego (base) o las actuales del
 *  Pokémon con el desglose por factor. */
export function SpeciesCard({ pk, species }: { pk: PokemonDetail; species: SpeciesDetail | undefined }) {
  const { t, dyn, dynOr } = useT();
  const catalog = useGame((s) => s.catalogIndex);
  const view = useSettings((s) => s.cardStatsView);
  const setView = useSettings((s) => s.setCardStatsView);
  const types = species?.types?.length ? species.types : (speciesEntry(catalog, pk.species?.id, pk.form)?.types ?? []);
  const base = species?.baseStats;
  const hasBase = !!base && STAT_IDS.every((s) => typeof base[s] === "number");
  const { parts, computed, nature, natureId } = useStatMath(pk, species);

  return (
    <div className={styles.head}>
      <div className={styles.headMain}>
        <PokemonIcon name={displayName(pk)} species={pk.species?.id ?? 0} form={pk.form} gender={pk.gender} shiny={pk.shiny} egg={pk.egg} size={72} />
        <div style={{ minWidth: 0 }}>
          <div className={styles.title}>
            {displayName(pk)} <span style={{ color: "var(--accent)" }}>{genderSymbol(pk.gender)}</span>
          </div>
          <div className="muted">
            {pk.species?.name}
            {pk.level != null && ` · ${t("party.level", { level: pk.level })}`}
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap", alignItems: "center" }}>
            {types.map((ty) => <TypeChip key={ty} id={ty} name={catalog?.types.get(ty)?.name} />)}
            <Chip>{pk.ref}</Chip>
            {pk.shiny && <Chip tone="warn">★ {t("party.shiny")}</Chip>}
          </div>
        </div>
      </div>
      <div className={styles.baseStats} data-testid="base-stats" aria-label={view === "base" ? t("pokemon.baseStats") : t("pokemon.currentStats")}>
        <Segmented
          className={styles.cardView}
          ariaLabel={t("pokemon.cardView.label")}
          value={view}
          onChange={setView}
          options={[
            { value: "base", label: t("pokemon.cardView.base") },
            { value: "current", label: t("pokemon.cardView.current") },
          ]}
        />
        {view === "base" ? (
          <>
            <div className={styles.baseStatsTitle}>
              <span>{t("pokemon.baseStats")}</span>
              {hasBase && <span className="muted mono">{t("pokemon.bst", { n: baseStatTotal(base) })}</span>}
            </div>
            {hasBase ? (
              STAT_IDS.map((s) => (
                <div key={s} className={styles.baseStatRow}>
                  <span className="muted">{dyn(`stat.${s}`)}</span>
                  <StatBar value={base[s]} max={255} label={`${t("pokemon.baseStats")}: ${dyn(`stat.${s}`)}`} />
                  <strong className="mono">{base[s]}</strong>
                </div>
              ))
            ) : (
              <p className="muted" style={{ fontSize: 12, margin: 0 }}>{t("pokemon.baseStatsHint")}</p>
            )}
          </>
        ) : (
          <CurrentStats
            pk={pk}
            base={base}
            parts={parts}
            computed={computed}
            natureName={natureId ? dynOr("nature", natureId, natureId) : ""}
            natureUp={nature?.up ?? null}
            natureDown={nature?.down ?? null}
          />
        )}
      </div>
    </div>
  );
}

/** Estadísticas actuales: una barra apilada por stat (base+nivel rojo, IV azul, EV naranja, naturaleza verde) y el total a la
 *  derecha. Sin los stats base de la especie (sin carpeta del juego) se muestran los totales guardados en la partida. */
function CurrentStats({
  pk,
  base,
  parts,
  computed,
  natureName,
  natureUp,
  natureDown,
}: {
  pk: PokemonDetail;
  base: SpeciesDetail["baseStats"] | undefined;
  parts: Record<StatId, StatBreakdown> | null;
  computed: Record<StatId, number> | null;
  natureName: string;
  natureUp: string | null;
  natureDown: string | null;
}) {
  const { t, dyn } = useT();
  const max = useMemo(() => {
    const totals = STAT_IDS.map((s) => (parts ? parts[s].total + Math.max(0, -parts[s].nature) : (pk.stats.cached[s] ?? 0)));
    return Math.max(120, ...totals) * 1.06;
  }, [parts, pk.stats.cached]);

  if (!parts || !computed) {
    return (
      <>
        <div className={styles.baseStatsTitle}>
          <span>{t("pokemon.currentStats")}</span>
        </div>
        {STAT_IDS.map((s) => (
          <div key={s} className={styles.baseStatRow}>
            <span className="muted">{dyn(`stat.${s}`)}</span>
            <StatBar value={pk.stats.cached[s]} max={max} label={`${t("pokemon.currentStats")}: ${dyn(`stat.${s}`)}`} />
            <strong className="mono">{pk.stats.cached[s] ?? "—"}</strong>
          </div>
        ))}
        <p className="muted" style={{ fontSize: 12, margin: "6px 0 0" }}>{t("pokemon.baseStatsHint")}</p>
      </>
    );
  }

  const baseOf = (s: StatId) => base?.[s] ?? "?";
  const segments = (s: StatId, p: StatBreakdown): StatSegment[] => {
    const stat = dyn(`stat.${s}`);
    const out: StatSegment[] = [
      { key: "base", value: p.base, color: PART_COLORS.base, tip: t("pokemon.statTip.base", { value: p.base, base: baseOf(s), level: pk.level }) },
      { key: "iv", value: p.iv, color: PART_COLORS.iv, tip: t("pokemon.statTip.iv", { value: p.iv, iv: pk.iv[s] }) },
      { key: "ev", value: p.ev, color: PART_COLORS.ev, tip: t("pokemon.statTip.ev", { value: p.ev, ev: pk.ev[s] }) },
    ];
    if (p.nature > 0) {
      out.push({ key: "nature", value: p.nature, color: PART_COLORS.nature, tip: t("pokemon.statTip.natureUp", { nature: natureName, value: p.nature, stat }) });
    } else if (p.nature < 0) {
      out.push({ key: "nature", value: -p.nature, color: PART_COLORS.nature, ghost: true, tip: t("pokemon.statTip.natureDown", { nature: natureName, value: -p.nature, stat }) });
    }
    return out;
  };

  return (
    <>
      <div className={styles.baseStatsTitle}>
        <span>{t("pokemon.currentStats")}</span>
        <span className="muted mono">{natureName}{natureUp && natureDown ? ` +${dyn(`stat.short.${natureUp}`)} −${dyn(`stat.short.${natureDown}`)}` : ""}</span>
      </div>
      {STAT_IDS.map((s) => (
        <div key={s} className={styles.baseStatRow}>
          <span className="muted">{dyn(`stat.${s}`)}</span>
          <StackedStatBar segments={segments(s, parts[s])} max={max} label={t("pokemon.statTip.total", { stat: dyn(`stat.${s}`), value: parts[s].total })} />
          <strong className="mono">{parts[s].total}</strong>
        </div>
      ))}
      <ul className={styles.statLegend} aria-label={t("pokemon.currentStats")}>
        {(["base", "iv", "ev", "nature"] as const).map((k) => (
          <li key={k}>
            <span className={styles.legendDot} style={{ background: PART_COLORS[k] }} aria-hidden="true" />
            {t(`pokemon.statParts.${k}`)}
          </li>
        ))}
      </ul>
    </>
  );
}
