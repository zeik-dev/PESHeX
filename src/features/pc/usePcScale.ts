import { useEffect, useState } from "react";

const BOX_W = 324;
const BOX_H = 296;
/** Ancho que ocupan la bandeja del equipo, el panel de datos y los huecos. */
export const REST_W = 470;
/** Alto que ocupan el selector de caja y los huecos encima/debajo del bitmap (dentro del contenedor). */
export const REST_H = 56;

/** Escala (2, 1.5 o 1) del bitmap de la caja: la mayor que cabe en el ancho de TODA la pantalla del
 *  PC (caja + equipo + datos) y en el ALTO DEL CONTENEDOR (la pantalla no scrollea). Si no cabe ni a 1, se encoge. */
export function pickScale(width: number, height = Infinity): number {
  const fitsW = (s: number) => width - REST_W >= BOX_W * s;
  const fitsH = (s: number) => height - REST_H >= BOX_H * s;
  for (const s of [2, 1.5, 1]) if (fitsW(s) && fitsH(s)) return s;
  const byW = Math.max(width * 0.6, 160) / BOX_W;
  return Math.max(0.5, Math.min(1, byW));
}

/** Escala de la caja segun el tamano del contenedor que se enlaza con `ref` (callback ref: el contenedor puede montarse
 *  mas tarde que el hook, p. ej. tras un spinner de carga). */
export function usePcScale(): { scale: number; ref: (el: HTMLElement | null) => void } {
  const [scale, setScale] = useState(2);
  const [el, setEl] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!el) return;
    const update = () => setScale(pickScale(el.clientWidth, el.clientHeight || Infinity));
    update();
    window.addEventListener("resize", update);
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    ro?.observe(el);
    return () => {
      window.removeEventListener("resize", update);
      ro?.disconnect();
    };
  }, [el]);
  return { scale, ref: setEl };
}
