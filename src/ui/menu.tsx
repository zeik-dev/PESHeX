import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { Popover, type PopoverPoint } from "./popover";
import styles from "./ui.module.css";
import { cx } from "./cx";

export interface MenuItem {
  id: string;
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}

/** Menu contextual (clic derecho): `role="menu"` con `menuitem`s; flechas, Inicio/Fin, Enter/Espacio y Esc. */
export function ContextMenu({
  open,
  point,
  items,
  label,
  onClose,
}: {
  open: boolean;
  point: PopoverPoint | null;
  items: MenuItem[];
  label: string;
  onClose: () => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  function move(e: KeyboardEvent, dir: 1 | -1 | "first" | "last") {
    const els = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []);
    if (els.length === 0) return;
    e.preventDefault();
    const at = els.indexOf(document.activeElement as HTMLButtonElement);
    const next = dir === "first" ? 0 : dir === "last" ? els.length - 1 : (at + dir + els.length) % els.length;
    els[next]?.focus();
  }

  return (
    <Popover open={open} onClose={onClose} point={point} placement="point" role="menu" label={label} className={styles.menu}>
      <div
        ref={listRef}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") move(e, 1);
          else if (e.key === "ArrowUp") move(e, -1);
          else if (e.key === "Home") move(e, "first");
          else if (e.key === "End") move(e, "last");
          else if (e.key === "Tab") onClose();
        }}
      >
        {items.map((it) => (
          <button
            key={it.id}
            type="button"
            role="menuitem"
            disabled={it.disabled}
            className={cx(styles.menuItem, it.danger && styles.menuDanger)}
            onClick={() => {
              onClose();
              it.onSelect();
            }}
          >
            {it.icon && <span className={styles.menuIcon}>{it.icon}</span>}
            <span>{it.label}</span>
          </button>
        ))}
      </div>
    </Popover>
  );
}
