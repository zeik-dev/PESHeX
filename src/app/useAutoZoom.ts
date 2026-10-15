import { useEffect } from "react";
import { useSession } from "../stores/session";
import { useSettings } from "../stores/settings";
import { appliedZoom, applyZoom, FALLBACK_NAV_WIDTH, fitZoom, hasNativeZoom } from "../lib/zoom";

/** Ancho (px CSS, al zoom actual) que necesitan TODAS las pestañas del encabezado: el contenido del `nav[data-fit-nav]` más su
 *  relleno. El ancho de los elementos en px CSS no depende del zoom nativo, así que sirve igual a cualquier escala. */
function measureNavWidth(): number | null {
  const nav = document.querySelector<HTMLElement>("[data-fit-nav]");
  const inner = nav?.firstElementChild as HTMLElement | null | undefined;
  if (!nav || !inner) return null;
  const css = getComputedStyle(nav);
  const pad = (parseFloat(css.paddingLeft) || 0) + (parseFloat(css.paddingRight) || 0);
  const width = inner.offsetWidth + pad;
  return width > 0 ? width : null;
}

/** Escala automática: mantiene a la vista todas las pestañas del encabezado SIN scroll y reescala al agrandar, reducir o
 *  maximizar la ventana (el alto también cuenta). Solo en la app de escritorio y con el modo «automático» (por defecto). */
export function useAutoZoom() {
  const mode = useSettings((s) => s.zoomMode);
  const lang = useSettings((s) => s.lang);
  const filePath = useSession((s) => s.filePath); // al abrir/cerrar un archivo aparece/desaparece el encabezado

  useEffect(() => {
    if (mode !== "auto" || !hasNativeZoom()) return;
    let alive = true;
    let raf = 0;
    let settle = 0;
    let lastNatural = FALLBACK_NAV_WIDTH;
    // Las pestañas cambian de ancho (idioma, roles, insignia de «Cambios»): se observa el contenido del `nav`.
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => schedule());
    let observed: Element | null = null;
    const observeNav = () => {
      const el = document.querySelector("[data-fit-nav]")?.firstElementChild ?? null;
      if (el === observed) return;
      if (observed) ro?.unobserve(observed);
      observed = el;
      if (el) ro?.observe(el);
    };

    const run = (passes: number) => {
      if (!alive) return;
      observeNav();
      const measured = measureNavWidth();
      if (measured) lastNatural = measured;
      const current = appliedZoom();
      // Al 100 % de zoom: el viewport en px CSS escala con el zoom nativo (más zoom = menos px CSS).
      const next = fitZoom({
        naturalWidth: lastNatural,
        availableWidth: (document.documentElement.clientWidth * current) / 100,
        availableHeight: (document.documentElement.clientHeight * current) / 100,
      });
      if (next !== current) {
        void applyZoom(next).then(() => {
          // Tras aplicarlo el viewport cambia: se vuelve a medir (converge en 1-2 pasadas).
          if (alive && passes > 0) settle = window.setTimeout(() => run(passes - 1), 120);
        });
      }
    };
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => run(3));
    };

    schedule();
    window.addEventListener("resize", schedule);
    void document.fonts?.ready.then(schedule);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      window.clearTimeout(settle);
      window.removeEventListener("resize", schedule);
      ro?.disconnect();
    };
  }, [mode, lang, filePath]);
}
