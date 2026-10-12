import { useTranslation } from "react-i18next";

/** `t` tipado (claves estaticas) + `dyn` para claves construidas en tiempo de
 *  ejecucion (naturalezas, estados, bolsillos...), que no se pueden tipar. */
export function useT() {
  const { t, i18n } = useTranslation();
  const dyn = (key: string, opts?: Record<string, unknown>): string =>
    t(key as never, (opts ?? {}) as never) as unknown as string;
  /** Traduce `prefix.ID` y, si no existe, devuelve `fallback`. */
  const dynOr = (prefix: string, id: string | number | null | undefined, fallback: string): string => {
    if (id == null) return fallback;
    const key = `${prefix}.${id}`;
    return i18n.exists(key) ? dyn(key) : fallback;
  };
  return { t, dyn, dynOr, locale: i18n.language as string };
}
