import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useSession } from "../stores/session";

/** Consulta semantica cuyo cache depende del archivo abierto y de la
 *  `revision` (sube con cada mutacion): al editar, todo se refresca solo. */
export function useSemanticQuery<T>(key: string | unknown[], fn: () => Promise<T>, enabled = true) {
  const revision = useSession((s) => s.revision);
  const filePath = useSession((s) => s.filePath);
  const parts = Array.isArray(key) ? key : [key];
  return useQuery({
    queryKey: [...parts, filePath, revision],
    queryFn: fn,
    enabled: enabled && !!filePath,
    placeholderData: keepPreviousData,
  });
}
