import { useCallback, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import styles from "./ui.module.css";
import { cx } from "./cx";

/** Separación entre el elemento y el globo y margen mínimo con el borde de la ventana. */
const GAP = 6;
const MARGIN = 6;

export interface TooltipPlacement {
  left: number;
  top: number;
  /** Abierto por debajo del elemento (no cabía arriba). */
  below: boolean;
}

/** Dónde pintar el globo: centrado sobre el elemento, por encima; si arriba no cabe, por debajo. Nunca se sale de la ventana. */
export function placeTooltip(
  anchor: { left: number; top: number; bottom: number; width: number },
  tip: { width: number; height: number },
  viewport: { width: number; height: number },
): TooltipPlacement {
  const below = anchor.top - GAP - tip.height < MARGIN;
  const top = below ? anchor.bottom + GAP : anchor.top - GAP - tip.height;
  const centered = anchor.left + anchor.width / 2 - tip.width / 2;
  const left = Math.max(MARGIN, Math.min(centered, viewport.width - tip.width - MARGIN));
  return { left, top: Math.max(MARGIN, Math.min(top, viewport.height - tip.height - MARGIN)), below };
}

/** Globo de ayuda al pasar el ratón (o al enfocar) por encima. Sustituye al `title=` nativo cuando el texto lleva formato
 *  o tiene que aparecer al instante. El contenido también se enlaza con `aria-describedby`. */
export function Tooltip({
  content,
  children,
  className,
  style,
  focusable,
}: {
  content: ReactNode;
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** Hace al elemento enfocable con el teclado (por defecto no: lo habitual es envolver algo que ya lo es). */
  focusable?: boolean;
}) {
  const id = useId();
  const anchorRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<TooltipPlacement | null>(null);

  const show = useCallback(() => setOpen(true), []);
  const hide = useCallback(() => {
    setOpen(false);
    setPlacement(null);
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    const a = anchorRef.current?.getBoundingClientRect();
    const t = tipRef.current?.getBoundingClientRect();
    if (!a || !t) return;
    setPlacement(placeTooltip(a, { width: t.width, height: t.height }, { width: window.innerWidth, height: window.innerHeight }));
  }, [open, content]);

  // Si la ventana cambia de tamaño o hace scroll con el globo abierto, se cierra (no queda flotando fuera de sitio).
  useLayoutEffect(() => {
    if (!open) return;
    window.addEventListener("resize", hide);
    window.addEventListener("scroll", hide, true);
    return () => {
      window.removeEventListener("resize", hide);
      window.removeEventListener("scroll", hide, true);
    };
  }, [open, hide]);

  return (
    <>
      <span
        ref={anchorRef}
        className={cx(styles.tipAnchor, className)}
        style={style}
        aria-describedby={open ? id : undefined}
        tabIndex={focusable ? 0 : undefined}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onKeyDown={(e) => {
          if (e.key === "Escape" && open) {
            e.stopPropagation();
            hide();
          }
        }}
      >
        {children}
      </span>
      {open &&
        createPortal(
          <div
            ref={tipRef}
            id={id}
            role="tooltip"
            className={styles.tip}
            style={placement ? { left: placement.left, top: placement.top } : { left: -9999, top: 0, visibility: "hidden" }}
          >
            {content}
          </div>,
          document.body,
        )}
    </>
  );
}
