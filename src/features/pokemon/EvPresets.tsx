import { Gauge } from "lucide-react";
import type { PokemonDetail, StatId } from "../../api/types";
import { STAT_IDS } from "../../api/types";
import { useT } from "../../lib/useT";
import { useEdit } from "../../stores/edit";
import { Button, SelectField } from "../../ui";
import { useSpeciesDetail } from "./useSpeciesDetail";
import { EV_PRESETS, evPresetOps, suggestEvPreset, type EvPreset, type EvSuggestion } from "./quick";
import styles from "./pokemon.module.css";

export interface EvAdvice {
  suggestion: EvSuggestion | null;
  /** De donde salen los stats: base de la especie (carpeta del juego) o los guardados en la partida. */
  source: "base" | "saved";
  stats: Partial<Record<StatId, number | null>>;
}

/** Preset de EV que encaja con los dos stats mas altos del Pokemon: los base de la especie si hay carpeta del juego, si no los guardados. */
export function useEvAdvice(pk: PokemonDetail): EvAdvice {
  const base = useSpeciesDetail(pk)?.baseStats;
  const fromBase = !!base && STAT_IDS.every((s) => typeof base[s] === "number");
  const stats = fromBase ? (base as Record<StatId, number>) : pk.stats.cached;
  return { suggestion: suggestEvPreset(stats), source: fromBase ? "base" : "saved", stats };
}

/** «Preset de EV sugerido» segun los stats mas altos + selector con todos los presets. */
export function EvPresetControl({ pk, editable }: { pk: PokemonDetail; editable: boolean }) {
  const { t, dyn } = useT();
  const apply = useEdit((s) => s.apply);
  const busy = useEdit((s) => s.busy);
  const { suggestion, source, stats } = useEvAdvice(pk);
  const off = !editable || busy;
  const run = (p: EvPreset) => void apply(evPresetOps(pk, p));

  return (
    <div className={styles.evPresets} data-testid="ev-presets">
      <div className={styles.quickRow}>
        {suggestion ? (
          <>
            <Button size="sm" variant="primary" disabled={off} data-preset={suggestion.preset} onClick={() => run(suggestion.preset)}>
              <Gauge size={14} /> {t("quick.evSuggested", { preset: dyn(`quick.ev.${suggestion.preset}`) })}
            </Button>
            <span className="muted" style={{ fontSize: 12 }}>
              {t("quick.evBecause", {
                a: `${dyn(`stat.${suggestion.top[0]}`)} ${stats[suggestion.top[0]]}`,
                b: `${dyn(`stat.${suggestion.top[1]}`)} ${stats[suggestion.top[1]]}`,
                source: t(source === "base" ? "quick.evSourceBase" : "quick.evSourceSaved"),
              })}
            </span>
          </>
        ) : (
          <span className="muted" style={{ fontSize: 12 }}>{t("quick.evNoData")}</span>
        )}
      </div>
      <div className={styles.quickRow}>
        <label className="muted" htmlFor={`ev-preset-${pk.ref}`} style={{ fontSize: 12 }}>{t("quick.evOthers")}</label>
        <SelectField<string>
          id={`ev-preset-${pk.ref}`}
          value=""
          disabled={off}
          options={[{ value: "", label: t("quick.evChoose") }, ...EV_PRESETS.map((p) => ({ value: p as string, label: dyn(`quick.ev.${p}`) }))]}
          onChange={(v) => v && run(v as EvPreset)}
        />
      </div>
    </div>
  );
}
