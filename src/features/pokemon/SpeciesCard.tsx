import { STAT_IDS, type PokemonDetail } from "../../api/types";
import { speciesEntry } from "../../game/lookup";
import type { SpeciesDetail } from "../../game/types";
import { baseStatTotal } from "../../lib/stats";
import { displayName, genderSymbol } from "../../lib/pokemon";
import { useT } from "../../lib/useT";
import { useGame } from "../../stores/game";
import { Chip, PokemonIcon, StatBar, TypeChip } from "../../ui";
import styles from "./pokemon.module.css";

/** Cabecera de la hoja: sprite, nombre, tipos y los STATS BASE de la especie en ESTE juego (de la carpeta del juego). */
export function SpeciesCard({ pk, species }: { pk: PokemonDetail; species: SpeciesDetail | undefined }) {
  const { t, dyn } = useT();
  const catalog = useGame((s) => s.catalogIndex);
  const types = species?.types?.length ? species.types : (speciesEntry(catalog, pk.species?.id, pk.form)?.types ?? []);
  const base = species?.baseStats;
  const hasBase = !!base && STAT_IDS.every((s) => typeof base[s] === "number");

  return (
    <div className={styles.head}>
      <div className={styles.headMain}>
        <PokemonIcon name={displayName(pk)} species={pk.species?.id ?? 0} form={pk.form} gender={pk.gender} shiny={pk.shiny} egg={pk.egg} size={84} />
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
      <div className={styles.baseStats} data-testid="base-stats" aria-label={t("pokemon.baseStats")}>
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
      </div>
    </div>
  );
}
