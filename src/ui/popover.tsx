import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import styles from "./ui.module.css";
import { cx } from "./cx";

export type PopoverPlacement = "left" | "bottom" | "point";

export interface PopoverPoint {
  x: number;
  y: number;
}

const GAP = 6;
const MARGIN = 8;

/** Calcula la esquina superior izquierda de un panel de `size` junto a `anchor` (o en `point`), sin salirse del viewport. */
export function placePopover(
  placement: PopoverPlacement,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  anchor: DOMRect | null,
  point: PopoverPoint | null,
): { left: number; top: number } {
  let left: number;
  let top: number;
  if (placement === "point" && point) {
    left = point.x;
    top = point.y;
  } else if (placement === "left" && anchor) {
    left = anchor.left - size.width - GAP; // el panel se abre hacia la izquierda del boton
    top = anchor.top;
    if (left < MARGIN) left = Math.min(anchor.right + GAP, viewport.width - size.width - MARGIN); // sin sitio: a la derecha
  } else if (anchor) {
    left = anchor.right - size.width; // alineado al borde derecho del boton, debajo
    top = anchor.bottom + GAP;
  } else {
    left = MARGIN;
    top = MARGIN;
  }
  left = Math.max(MARGIN, Math.min(left, viewport.width - size.width - MARGIN));
  top = Math.max(MARGIN, Math.min(top, viewport.height - size.height - MARGIN));
  return { left, top };
}

/** Panel flotante anclado a un elemento (o a un punto, p. ej. el clic derecho). Se pinta en un portal fuera de
 *  cualquier contenedor con scroll/overflow, se cierra con Esc o al pulsar fuera, y se recoloca al hacer scroll o
 *  cambiar el tamano de la ventana. */
export function Popover({
  open,
  onClose,
  anchorRef,
  point,
  placement = "bottom",
  role = "dialog",
  label,
  className,
  children,
}: {
  open: boolean;
  onClose: () => void;
  anchorRef?: RefObject<HTMLElement | null>;
  point?: PopoverPoint | null;
  placement?: PopoverPlacement;
  role?: "dialog" | "menu";
  label: string;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const place = () => {
      const el = ref.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setPos(
        placePopover(
          placement,
          { width: rect.width, height: rect.height },
          { width: window.innerWidth, height: window.innerHeight },
          anchorRef?.current?.getBoundingClientRect() ?? null,
          point ?? null,
        ),
      );
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, placement, point, anchorRef]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation(); // no cierra tambien el panel (drawer/modal) que contiene el boton
      e.stopImmediatePropagation();
      onClose();
      anchorRef?.current?.focus();
    };
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (ref.current?.contains(target) || anchorRef?.current?.contains(target)) return;
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("mousedown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("mousedown", onDown, true);
    };
  }, [open, onClose, anchorRef]);

  useEffect(() => {
    if (open && pos) {
      const first = ref.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled), button:not(:disabled), input, select');
      (first ?? ref.current)?.focus();
    }
    // solo al abrirse (cuando ya esta colocado), no en cada recolocacion
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pos === null]);

  if (!open) return null;
  return createPortal(
    <div
      ref={ref}
      role={role}
      aria-label={label}
      tabIndex={-1}
      className={cx(styles.popover, className)}
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999, visibility: "hidden" }}
    >
      {children}
    </div>,
    document.body,
  );
}
