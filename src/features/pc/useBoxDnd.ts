import { useCallback, useEffect, useRef, useState } from "react";

/** Distancia (px) que hay que arrastrar antes de considerar que es un arrastre y no un clic. */
export const DRAG_THRESHOLD = 5;
/** Espera sobre las flechas de caja antes de cambiar de caja mientras se arrastra. */
export const NAV_DWELL_MS = 600;

export interface DragInfo {
  /** ref del Pokemon que se arrastra. */
  ref: string;
  /** ref de la casilla sobre la que esta el puntero (o null). */
  over: string | null;
}

export interface DndOptions {
  /** Mueve/intercambia: `from` = ref del Pokemon, `to` = ref de la casilla destino. */
  onDrop: (from: string, to: string) => void;
  /** Se llama (repetidamente) mientras se arrastra sobre las flechas de caja. */
  onNav?: (dir: "prev" | "next") => void;
  /** Inyectable para pruebas. */
  elementFromPoint?: (x: number, y: number) => Element | null;
}

/** Arrastrar y soltar con PUNTERO (no HTML5 DnD: en Windows deja de funcionar dentro
 *  de WebView2 mientras la ventana acepta archivos arrastrados) + modo teclado
 *  "agarrar/soltar" con Espacio. Las casillas son destinos si llevan `data-drop`,
 *  las flechas de caja si llevan `data-nav="prev|next"`. */
export function useBoxDnd(options: DndOptions) {
  const [drag, setDrag] = useState<DragInfo | null>(null);
  const [grab, setGrab] = useState<string | null>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const opts = useRef(options);
  opts.current = options;
  const cleanup = useRef<(() => void) | null>(null);
  const justDragged = useRef(false);

  useEffect(() => () => cleanup.current?.(), []);

  const dragProps = useCallback((ref: string) => ({
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0 || e.pointerType === "touch") return; // en tactil, el arrastre usa el modo teclado/toque
      cleanup.current?.();
      const start = { x: e.clientX, y: e.clientY };
      let active = false;
      let over: string | null = null;
      let navTimer: ReturnType<typeof setTimeout> | null = null;
      let navDir: string | null = null;
      const at = opts.current.elementFromPoint ?? ((x: number, y: number) => document.elementFromPoint(x, y));

      const stopNav = () => {
        if (navTimer) clearInterval(navTimer);
        navTimer = null;
        navDir = null;
      };
      const finish = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        window.removeEventListener("keydown", onKey);
        stopNav();
        cleanup.current = null;
        setDrag(null);
      };
      const onMove = (ev: PointerEvent) => {
        if (!active) {
          if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < DRAG_THRESHOLD) return;
          active = true;
          justDragged.current = true;
          setDrag({ ref, over: null });
        }
        const g = ghostRef.current;
        if (g) g.style.transform = `translate(${ev.clientX + 8}px, ${ev.clientY + 8}px)`;
        const el = at(ev.clientX, ev.clientY);
        const nextOver = el?.closest("[data-drop]")?.getAttribute("data-drop") ?? null;
        if (nextOver !== over) {
          over = nextOver;
          setDrag({ ref, over });
        }
        const dir = el?.closest("[data-nav]")?.getAttribute("data-nav") ?? null;
        if (dir !== navDir) {
          stopNav();
          if (dir === "prev" || dir === "next") {
            navDir = dir;
            navTimer = setInterval(() => opts.current.onNav?.(dir), NAV_DWELL_MS);
          }
        }
      };
      const onUp = () => {
        const target = over;
        const was = active;
        finish();
        if (was) {
          setTimeout(() => (justDragged.current = false), 0); // el clic que sigue al arrastre se ignora
          if (target && target !== ref) opts.current.onDrop(ref, target);
        }
      };
      const onCancel = () => {
        finish();
        if (active) setTimeout(() => (justDragged.current = false), 0);
      };
      const onKey = (ev: KeyboardEvent) => {
        if (ev.key === "Escape") onCancel();
      };
      window.addEventListener("pointermove", onMove, { passive: true });
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
      window.addEventListener("keydown", onKey);
      cleanup.current = finish;
    },
  }), []);

  /** ¿El clic que se esta procesando es el final de un arrastre? (hay que ignorarlo) */
  const wasDragged = useCallback(() => justDragged.current, []);

  /** Teclado: Espacio agarra el Pokemon de la casilla y, con uno agarrado, lo suelta en la casilla
   *  actual (si esta vacia lo mueve; si esta ocupada, intercambia). Esc cancela. */
  const onCellKey = useCallback((e: React.KeyboardEvent, occupant: string | null, dropRef: string): boolean => {
    if (e.key === " ") {
      e.preventDefault();
      if (grab == null) {
        if (occupant) setGrab(occupant);
      } else {
        if (grab !== dropRef && grab !== occupant) opts.current.onDrop(grab, dropRef);
        setGrab(null);
      }
      return true;
    }
    if (e.key === "Escape" && grab != null) {
      e.preventDefault();
      e.stopPropagation();
      setGrab(null);
      return true;
    }
    return false;
  }, [grab]);

  const cancelGrab = useCallback(() => setGrab(null), []);

  return { drag, grab, ghostRef, dragProps, wasDragged, onCellKey, cancelGrab };
}
