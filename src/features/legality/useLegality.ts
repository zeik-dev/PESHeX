import type { Flag, LegalityReport } from "../../api/types";
import { semantic } from "../../api/semantic";
import { useSemanticQuery } from "../queries";

/** Informe de legalidad de todo el save (cacheado por revision en el driver y en react-query). */
export function useLegality(enabled = true) {
  return useSemanticQuery<LegalityReport>(["legality"], () => semantic.legality(), enabled);
}

export type FlagMap = Record<string, Flag[]>;
