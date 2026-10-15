import { useMemo } from "react";
import { STAT_IDS, type PokemonDetail, type StatId } from "../../api/types";
import type { SpeciesDetail } from "../../game/types";
import { NATURE_EFFECTS, calcAllStats, statBreakdowns, type NatureEffect, type StatBreakdown } from "../../lib/stats";
import { useGame } from "../../stores/game";

export interface StatMath {
  /** Id de la naturaleza que cuenta para los stats (la de menta si la hay). */
  natureId: string | undefined;
  nature: NatureEffect | null;
  /** Stats totales con la fórmula del juego, o null si faltan datos (stats base, nivel, IV o EV). */
  computed: Record<StatId, number> | null;
  /** El mismo total, repartido en lo que aporta cada factor. */
  parts: Record<StatId, StatBreakdown> | null;
}

/** Cálculo de los stats de un Pokémon con los datos de ESTE juego; lo comparten la ficha y la pestaña IV y EV. */
export function useStatMath(pk: PokemonDetail, species: SpeciesDetail | undefined): StatMath {
  const catalog = useGame((s) => s.catalog);
  const base = species?.baseStats;
  const natureId = (pk.natureForStats?.id ?? pk.nature?.id) as string | undefined;
  const nature = useMemo<NatureEffect | null>(() => {
    if (!natureId) return null;
    const n = catalog?.natures.find((x) => x.id === natureId);
    return n ?? NATURE_EFFECTS[natureId] ?? null;
  }, [catalog, natureId]);
  return useMemo(() => {
    const hasBase = !!base && STAT_IDS.every((s) => typeof base[s] === "number");
    if (!hasBase || pk.level == null || STAT_IDS.some((s) => pk.iv[s] == null || pk.ev[s] == null)) {
      return { natureId, nature, computed: null, parts: null };
    }
    return {
      natureId,
      nature,
      computed: calcAllStats(base, pk.level, pk.iv, pk.ev, nature),
      parts: statBreakdowns(base, pk.level, pk.iv, pk.ev, nature),
    };
  }, [base, pk.level, pk.iv, pk.ev, nature, natureId]);
}
