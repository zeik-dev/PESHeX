import type { PokemonPatch } from "../../api/types";
import { useEdit } from "../../stores/edit";

/** Aplica un parche al Pokémon `ref` (cada edición es una transacción que se puede deshacer). */
export function usePatch(ref: string) {
  const apply = useEdit((s) => s.apply);
  return (patch: PokemonPatch) => void apply([{ op: "pokemon.patch", ref, patch }]);
}
