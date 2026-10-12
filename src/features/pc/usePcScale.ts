import { useEffect, useState, type RefObject } from "react";

const BOX_W = 324;
const BOX_H = 296;
/** Ancho que ocupan la bandeja del equipo, el panel de datos y los huecos. */
const REST_W = 450;
/** Alto que ocupan la cabecera, el titulo y la barra de la caja encima del bitmap. */
const REST_H = 250;

/** Escala (2, 1.5 o 1) del bitmap de la caja: la mayor que cabe en el ancho de TODA la pantalla del
 *  PC (caja + equipo + datos) y en el alto de la ventana. Si no cabe ni a 1, se encoge. */
export function pickScale(width: number, height = Infinity): number {
  const fitsW = (s: number) => width - REST_W >= BOX_W * s;
  const fitsH = (s: number) => height - REST_H >= BOX_H * s;
  for (const s of [2, 1.5, 1]) if (fitsW(s) && fitsH(s)) return s;
  const byW = Math.max(width * 0.6, 160) / BOX_W;
  return Math.max(0.5, Math.min(1, byW));
}

export function usePcScale(ref: RefObject<HTMLElement | null>): number {
  const [scale, setScale] = useState(2);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setScale(pickScale(el.clientWidth, window.innerHeight));
    update();
    window.addEventListener("resize", update);
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    ro?.observe(el);
    return () => {
      window.removeEventListener("resize", update);
      ro?.disconnect();
    };
  }, [ref]);
  return scale;
}
