import { useCallback } from "react";
import { useT } from "../../lib/useT";
import { useEdit } from "../../stores/edit";
import { useToasts } from "../../stores/toasts";

/** Clona un Pokémon en la primera casilla libre del PC (acción compartida por el panel de datos y el menú contextual). */
export function useClonePokemon(): (ref: string) => Promise<void> {
  const { t } = useT();
  const apply = useEdit((s) => s.apply);
  return useCallback(
    async (ref: string) => {
      const r = await apply([{ op: "pokemon.clone", ref, to: "auto" }]);
      if (r?.applied) useToasts.getState().push({ kind: "success", text: t("quick.cloned") });
    },
    [apply, t],
  );
}
