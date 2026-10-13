import { gameApi } from "../../api/game";
import type { PokemonSummary } from "../../api/types";
import type { SpeciesDetail } from "../../game/types";
import { useGame } from "../../stores/game";
import { useSemanticQuery } from "../queries";

/** Ficha de la especie del Pokémon (stats base, habilidades, movimientos aprendibles...) cuando hay carpeta del juego.
 *  Acepta ids internos y los numeros de las bases <= v18. */
export function useSpeciesDetail(pk: Pick<PokemonSummary, "species" | "form">): SpeciesDetail | undefined {
  const linked = useGame((s) => s.status.linked);
  const id = pk.species?.id;
  const q = useSemanticQuery<SpeciesDetail>(
    ["species", id, pk.form],
    () => gameApi.species(id as string | number, pk.form ?? 0),
    linked && id != null,
  );
  return q.data;
}
