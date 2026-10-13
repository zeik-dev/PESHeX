import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { rankSearch } from "../game/fuzzy";
import styles from "./ui.module.css";
import { cx } from "./cx";

export interface ComboOption {
  id: string;
  label: string;
  /** Texto secundario (el ID interno, el tipo...). */
  sub?: string;
  icon?: ReactNode;
}

const MAX_RESULTS = 60;

const LIST_MAX_HEIGHT = 320; // = max-height de .comboList
const LIST_MIN_WIDTH = 240;
const LIST_GAP = 2;
const LIST_MARGIN = 8;

export interface DropdownPlacement {
  left: number;
  width: number;
  /** Abierto hacia abajo: distancia desde el borde superior de la ventana. */
  top?: number;
  /** Abierto hacia arriba: distancia desde el borde inferior de la ventana. */
  bottom?: number;
  maxHeight: number;
  up: boolean;
}

/** Dónde pintar el desplegable de un campo (`anchor`) sin salirse de la ventana: hacia abajo si cabe; si no, hacia arriba
 *  cuando allí hay más sitio (p. ej. el 4.º movimiento de un Pokémon de la última fila). El alto se limita al espacio libre
 *  del lado elegido. `prefer` mantiene el lado ya elegido mientras siga cabiendo (no salta al escribir y filtrar). */
export function placeDropdown(
  anchor: { left: number; top: number; bottom: number; width: number },
  viewport: { width: number; height: number },
  contentHeight: number,
  prefer?: "up" | "down",
): DropdownPlacement {
  const below = viewport.height - anchor.bottom - LIST_GAP - LIST_MARGIN;
  const above = anchor.top - LIST_GAP - LIST_MARGIN;
  const want = Math.min(contentHeight, LIST_MAX_HEIGHT);
  const fitsBelow = below >= want;
  const fitsAbove = above >= want;
  let up: boolean;
  if (prefer === "up" && fitsAbove) up = true;
  else if (prefer === "down" && fitsBelow) up = false;
  else up = !fitsBelow && above > below;
  const room = up ? above : below;
  const maxHeight = Math.max(80, Math.min(LIST_MAX_HEIGHT, room));
  const width = Math.min(Math.max(anchor.width, LIST_MIN_WIDTH), Math.max(viewport.width - 2 * LIST_MARGIN, 0));
  const left = Math.max(LIST_MARGIN, Math.min(anchor.left, viewport.width - width - LIST_MARGIN));
  return up
    ? { left, width, bottom: viewport.height - anchor.top + LIST_GAP, maxHeight, up }
    : { left, width, top: anchor.bottom + LIST_GAP, maxHeight, up };
}

/** Selector con busqueda (difusa, sin acentos) para especies, movimientos, objetos y
 *  habilidades. ARIA combobox/listbox con teclado: flechas, Enter, Esc.
 *  `allowCustom` deja confirmar un ID que no esta en la lista (bases con contenido propio). */
export function ComboBox({
  id,
  value,
  options,
  onChange,
  disabled,
  placeholder,
  ariaLabel,
  allowCustom,
  nullable,
  mono,
  limit = MAX_RESULTS,
}: {
  id?: string;
  value: string | null | undefined;
  options: ComboOption[];
  onChange: (id: string | null) => void;
  disabled?: boolean;
  placeholder?: string;
  ariaLabel?: string;
  allowCustom?: boolean;
  /** Permite vaciar el campo (confirma `null`). */
  nullable?: boolean;
  mono?: boolean;
  /** Máximo de resultados que lista el desplegable (60 por defecto; `Infinity` = todos, para movimientos y habilidades). */
  limit?: number;
}) {
  const autoId = useId();
  const listId = `${autoId}-list`;
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const sideRef = useRef<"up" | "down" | undefined>(undefined);
  const current = useMemo(() => options.find((o) => o.id === value), [options, value]);
  const shown = current ? current.label : (value ?? "");
  const [text, setText] = useState(shown);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [placement, setPlacement] = useState<DropdownPlacement | null>(null);

  useEffect(() => {
    if (!open) setText(shown);
  }, [shown, open]);

  const results = useMemo(
    () => (open ? rankSearch(options, text === shown ? "" : text, (o) => [o.label, o.id, o.sub], limit) : []),
    [open, options, text, shown, limit],
  );

  // Al abrir sin escribir, la opción activa es la del valor actual (en listas largas queda a la vista); al escribir, la primera.
  useEffect(() => {
    const selected = open && text === shown ? results.findIndex((o) => o.id === value) : -1;
    setActive(selected > 0 ? selected : 0);
  }, [text, open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Con listas largas (todos los movimientos) la opción activa se mantiene a la vista al navegar con el teclado.
  useEffect(() => {
    if (open) document.getElementById(`${autoId}-opt-${active}`)?.scrollIntoView?.({ block: "nearest" });
  }, [open, active, autoId, results]);

  // Se coloca junto al campo y se recoloca al cambiar los resultados, al hacer scroll o al redimensionar la ventana.
  useLayoutEffect(() => {
    if (!open) {
      sideRef.current = undefined;
      setPlacement(null);
      return;
    }
    const place = () => {
      const r = inputRef.current?.getBoundingClientRect();
      if (!r) return;
      const content = (listRef.current?.scrollHeight ?? LIST_MAX_HEIGHT) + 2; // + borde
      const next = placeDropdown(r, { width: window.innerWidth, height: window.innerHeight }, content, sideRef.current);
      sideRef.current = next.up ? "up" : "down";
      // Sin cambios no se vuelve a pintar (un scroll dentro de la lista larga dispararia cientos de renders).
      setPlacement((prev) => (prev && prev.left === next.left && prev.width === next.width && prev.top === next.top && prev.bottom === next.bottom && prev.maxHeight === next.maxHeight ? prev : next));
    };
    const onScroll = (e: Event) => {
      if (e.target !== listRef.current) place(); // el scroll de la propia lista no mueve el campo
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open, results]);

  function choose(o: ComboOption) {
    setOpen(false);
    setText(o.label);
    if (o.id !== value) onChange(o.id);
  }

  function commitText() {
    const t = text.trim();
    setOpen(false);
    if (t === "" && nullable && value != null) {
      onChange(null);
      return;
    }
    if (t === "" || t === shown) {
      setText(shown);
      return;
    }
    const exact = options.find((o) => o.id.toLowerCase() === t.toLowerCase() || o.label.toLowerCase() === t.toLowerCase());
    if (exact) {
      if (exact.id !== value) onChange(exact.id);
    } else if (allowCustom) {
      onChange(t);
    } else {
      setText(shown);
    }
  }

  const activeId = open && results[active] ? `${autoId}-opt-${active}` : undefined;

  return (
    <>
      <input
        ref={inputRef}
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        aria-label={ariaLabel}
        autoComplete="off"
        spellCheck={false}
        className={cx(styles.input, mono && "mono")}
        value={text}
        placeholder={placeholder}
        disabled={disabled}
        onFocus={(e) => {
          setOpen(true);
          e.target.select();
        }}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
        }}
        onBlur={commitText}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(a + 1, Math.max(0, results.length - 1)));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (open && results[active]) choose(results[active]);
            else inputRef.current?.blur();
          } else if (e.key === "Escape" && open) {
            e.stopPropagation(); // no cierra el panel que contiene el campo
            setOpen(false);
            setText(shown);
          }
        }}
      />
      {open &&
        createPortal(
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            className={styles.comboList}
            data-side={placement?.up ? "up" : "down"}
            style={
              placement
                ? { left: placement.left, top: placement.top, bottom: placement.bottom, width: placement.width, maxHeight: placement.maxHeight }
                : { left: -9999, top: 0, visibility: "hidden" } // primera pasada: se mide antes de colocarlo
            }
          >
            {results.length === 0 && <li className={styles.comboEmpty}>—</li>}
            {results.map((o, i) => (
              <li
                key={o.id}
                id={`${autoId}-opt-${i}`}
                role="option"
                aria-selected={o.id === value}
                className={cx(styles.comboOption, i === active && styles.comboActive)}
                onMouseDown={(e) => {
                  e.preventDefault(); // no pierde el foco del input
                  choose(o);
                }}
                onMouseEnter={() => setActive(i)}
              >
                {o.icon && <span className={styles.comboIcon}>{o.icon}</span>}
                <span className={styles.comboLabel}>{o.label}</span>
                {o.sub && <span className={cx(styles.comboSub, "mono")}>{o.sub}</span>}
              </li>
            ))}
          </ul>,
          document.body,
        )}
    </>
  );
}
