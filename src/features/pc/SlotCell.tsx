import { memo } from "react";
import type { PokemonSummary } from "../../api/types";
import { displayName, genderSymbol } from "../../lib/pokemon";
import { useT } from "../../lib/useT";
import { BallIcon, HeldItemMark, PokemonIcon } from "../../ui";
import { cx } from "../../ui";
import styles from "./pc.module.css";

export interface SlotCellProps {
  /** ref de destino de la casilla (party/N, box/B/S): se usa como data-drop. */
  dropRef: string;
  pk: PokemonSummary | null;
  /** Lado de la casilla en px y alto del icono. */
  size: number;
  iconSize: number;
  selected?: boolean;
  grabbed?: boolean;
  over?: boolean;
  /** Atenuada (filtro "solo ilegales"). */
  dim?: boolean;
  tabbable?: boolean;
  /** Variante grande del Equipo (con nombre, nivel y PS). */
  variant?: "grid" | "party";
  style?: React.CSSProperties;
  onSelect: (dropRef: string) => void;
  onOpen: (ref: string) => void;
  onPointerDown?: (e: React.PointerEvent) => void;
  onKeyDown: (e: React.KeyboardEvent, pk: PokemonSummary | null, dropRef: string) => void;
  wasDragged: () => boolean;
  /** Clic derecho (o tecla de menu): abre el menu contextual de la casilla. */
  onContextMenu?: (e: React.MouseEvent, pk: PokemonSummary | null, dropRef: string) => void;
  /** Etiqueta de legalidad, si existe. */
  flag?: "illegal" | "warning" | null;
}

function SlotCellImpl(p: SlotCellProps) {
  const { t } = useT();
  const { pk } = p;
  const name = pk ? (pk.egg ? t("party.egg") : displayName(pk)) : t("boxes.emptySlot");
  const label = pk
    ? [name, pk.species && !pk.egg ? pk.species.name : null, pk.level != null ? t("party.level", { level: pk.level }) : null, genderSymbol(pk.gender)]
        .filter(Boolean)
        .join(", ")
    : name;

  return (
    <button
      type="button"
      data-drop={p.dropRef}
      data-ref={pk?.ref}
      data-cell={p.dropRef}
      tabIndex={p.tabbable ? 0 : -1}
      aria-label={label}
      aria-pressed={p.selected}
      className={cx(styles.cell, p.variant === "party" && styles.partyCell, pk ? styles.filled : styles.emptyCell,
        p.selected && styles.selected, p.grabbed && styles.grabbed, p.over && styles.over, p.dim && styles.dim)}
      style={p.variant === "party" ? p.style : { width: p.size, height: p.size, ...p.style }}
      onPointerDown={pk ? p.onPointerDown : undefined}
      onClick={() => {
        if (p.wasDragged()) return;
        p.onSelect(p.dropRef);
      }}
      onDoubleClick={() => pk && !p.wasDragged() && p.onOpen(pk.ref)}
      onKeyDown={(e) => p.onKeyDown(e, pk, p.dropRef)}
      onContextMenu={p.onContextMenu ? (e) => p.onContextMenu!(e, pk, p.dropRef) : undefined}
    >
      {pk && (
        <>
          <span className={styles.icon} style={{ width: p.iconSize, height: p.iconSize }}>
            <PokemonIcon name={displayName(pk)} species={pk.species?.id ?? 0} form={pk.form} gender={pk.gender} shiny={pk.shiny}
              egg={pk.egg} size={p.iconSize} />
          </span>
          <span className={styles.marks} aria-hidden="true">
            {pk.item && !pk.egg && (
              <span className={styles.itemMark} title={pk.item.name}>
                <HeldItemMark size={Math.max(10, Math.round(p.size / 4))} />
                <span className={styles.itemDot} />
              </span>
            )}
            {pk.shiny && <span className={styles.shiny}>★</span>}
            {!pk.egg && pk.gender != null && pk.gender < 2 && (
              <span className={cx(styles.gender, pk.gender === 0 ? styles.male : styles.female)}>{genderSymbol(pk.gender)}</span>
            )}
            {p.flag && <span className={cx(styles.flag, p.flag === "illegal" ? styles.flagBad : styles.flagWarn)}>{p.flag === "illegal" ? "✗" : "!"}</span>}
          </span>
          {p.variant === "party" && (
            <span className={styles.partyBody}>
              <span className={styles.partyName}>{name}</span>
              <span className={styles.partyMeta}>
                {pk.level != null ? t("party.level", { level: pk.level }) : ""}
                {pk.item ? ` · ${pk.item.name}` : ""}
              </span>
              <span className={styles.partyHp}>
                <span
                  className={styles.partyHpFill}
                  style={{
                    width: `${pk.hp != null && pk.totalHp ? Math.min(100, (pk.hp / pk.totalHp) * 100) : 0}%`,
                  }}
                />
              </span>
              <span className={styles.partyHpText}>
                {t("party.hp")} {pk.hp ?? "?"}/{pk.totalHp ?? "?"}
              </span>
            </span>
          )}
          {pk.ball != null && p.variant === "party" && (
            <span className={styles.ballMark}>
              <BallIcon ball={pk.ball} size={18} />
            </span>
          )}
        </>
      )}
    </button>
  );
}

export const SlotCell = memo(SlotCellImpl);
