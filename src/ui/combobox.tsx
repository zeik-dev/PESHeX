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
}) {
  const autoId = useId();
  const listId = `${autoId}-list`;
  const inputRef = useRef<HTMLInputElement>(null);
  const current = useMemo(() => options.find((o) => o.id === value), [options, value]);
  const shown = current ? current.label : (value ?? "");
  const [text, setText] = useState(shown);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [rect, setRect] = useState<{ left: number; top: number; width: number } | null>(null);

  useEffect(() => {
    if (!open) setText(shown);
  }, [shown, open]);

  const results = useMemo(
    () => (open ? rankSearch(options, text === shown ? "" : text, (o) => [o.label, o.id, o.sub], MAX_RESULTS) : []),
    [open, options, text, shown],
  );

  useEffect(() => setActive(0), [text, open]);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = inputRef.current?.getBoundingClientRect();
      if (r) setRect({ left: r.left, top: r.bottom + 2, width: r.width });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

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
        rect &&
        createPortal(
          <ul
            id={listId}
            role="listbox"
            className={styles.comboList}
            style={{ left: rect.left, top: rect.top, width: Math.max(rect.width, 240) }}
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
