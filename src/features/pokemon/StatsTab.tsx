import { Calculator, Eraser } from "lucide-react";
import { STAT_IDS, type PokemonDetail, type PokemonPatch, type StatId } from "../../api/types";
import type { SpeciesDetail } from "../../game/types";
import { hiddenPower } from "../../lib/hiddenPower";
import { useT } from "../../lib/useT";
import { useEdit } from "../../stores/edit";
import { useGame } from "../../stores/game";
import { Button, Chip, SliderField, TypeChip } from "../../ui";
import { EvPresetControl } from "./EvPresets";
import { useRecalcAvailable } from "./QuickActions";
import { usePatch } from "./editorShared";
import { useStatMath } from "./useStatMath";
import styles from "./pokemon.module.css";

/** Pestaña IV y EV, en este orden: IV → Poder oculto → acciones de IV → EV → presets + limpiar EV → estadísticas
 *  totales → recalcular. Los IV/EV tienen deslizador y campo numérico; arrastrar es UNA edición (un solo deshacer). */
export function StatsTab({ pk, editable, species }: { pk: PokemonDetail; editable: boolean; species: SpeciesDetail | undefined }) {
  const { t, dyn } = useT();
  const patch = usePatch(pk.ref);
  const apply = useEdit((s) => s.apply);
  const busy = useEdit((s) => s.busy);
  const catalog = useGame((s) => s.catalog);
  const recalc = useRecalcAvailable();
  const lim = pk.limits;
  const off = !editable || busy;
  const legacy = typeof pk.species?.id === "number";
  const setAll = (key: "iv" | "ev", value: number) =>
    patch({ [key]: Object.fromEntries(STAT_IDS.map((s) => [s, value])) } as PokemonPatch);

  const block = (key: "iv" | "ev", max: number) =>
    STAT_IDS.map((s: StatId) => (
      <div key={s} className={styles.statRow}>
        <span className={styles.statName}>{dyn(`stat.${s}`)}</span>
        <SliderField value={pk[key][s]} min={0} max={max} disabled={!editable || pk[key][s] == null}
          ariaLabel={`${key.toUpperCase()} ${dyn(`stat.${s}`)}`} onCommit={(n) => patch({ [key]: { [s]: n } } as PokemonPatch)} />
      </div>
    ));

  const hp = hiddenPower(pk.iv, legacy);
  const hpType = hp ? catalog?.types.find((ty) => ty.id === hp.type)?.name : null;

  // Estadísticas totales con la formula del juego (la naturaleza efectiva es la de menta si la hay).
  const { computed } = useStatMath(pk, species);

  return (
    <div className={styles.statsTab}>
      <section>
        <div className={styles.sectionLabel}>{t("pokemon.iv")}</div>
        {block("iv", lim.ivMax)}
      </section>

      <section className={styles.hiddenPower} data-testid="hidden-power">
        <strong>{t("pokemon.hiddenPower")}</strong>
        {hp ? (
          <>
            <TypeChip id={hp.type} name={hpType} />
            <span className="muted">{t("pokemon.hiddenPowerPower", { power: hp.power })}</span>
          </>
        ) : (
          <span className="muted">—</span>
        )}
      </section>

      <section>
        <div className={styles.sectionLabel}>{t("pokemon.quick.ivTitle")}</div>
        <div className={styles.quickRow}>
          <Button size="sm" disabled={off} onClick={() => setAll("iv", lim.ivMax)}>{t("pokemon.quick.perfectIv")}</Button>
          <Button size="sm" disabled={off} onClick={() => setAll("iv", 0)}>{t("pokemon.quick.clearIv")}</Button>
        </div>
      </section>

      <section>
        <div className={styles.sectionLabel}>{t("pokemon.ev")}</div>
        {block("ev", lim.evStatMax)}
        <div className={styles.total}>
          <strong>{t("pokemon.evTotal")}</strong>
          <Chip tone={pk.evTotal > lim.evTotalMax ? "warn" : "good"}>{t("pokemon.evTotalLimit", { total: pk.evTotal, max: lim.evTotalMax })}</Chip>
        </div>
      </section>

      <section className={styles.evActions}>
        <EvPresetControl pk={pk} editable={editable} />
        <Button size="sm" disabled={off} onClick={() => setAll("ev", 0)}>
          <Eraser size={14} /> {t("pokemon.quick.clearEv")}
        </Button>
      </section>

      <section>
        <div className={styles.sectionLabel}>{t("pokemon.totalStats")}</div>
        <div className={styles.cached} data-testid="total-stats">
          {STAT_IDS.map((s) => {
            const calc = computed?.[s];
            const saved = pk.stats.cached[s];
            return (
              <div key={s} className={styles.cachedItem}>
                <span className="muted">{dyn(`stat.${s}`)}</span>
                <strong>{calc ?? saved ?? "—"}</strong>
                {calc != null && saved != null && calc !== saved && (
                  <span className={styles.statDiff} title={t("pokemon.totalStatsDiff")}>{t("pokemon.totalStatsSaved", { n: saved })}</span>
                )}
              </div>
            );
          })}
        </div>
        <p className="muted" style={{ fontSize: 12, margin: "8px 0 0" }}>
          {computed ? t("pokemon.totalStatsHint") : t("pokemon.totalStatsSavedOnly")}
        </p>
      </section>

      <section>
        <Button disabled={off || !recalc} title={recalc ? t("quick.recalcHint") : t("quick.recalcUnavailable")}
          onClick={() => void apply([{ op: "pokemon.recalc", ref: pk.ref }])}>
          <Calculator size={14} /> {t("quick.recalc")}
        </Button>
      </section>
    </div>
  );
}
