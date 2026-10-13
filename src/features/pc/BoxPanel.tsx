import { ChevronLeft, ChevronRight, Pencil } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import type { BoxDto, PokemonSummary } from "../../api/types";
import { boxGeometry, resolveBoxBackground } from "../../game/resolve/box";
import { useT } from "../../lib/useT";
import { useGame } from "../../stores/game";
import { Button, GameImage, SelectField, TextField, cx } from "../../ui";
import { SlotCell } from "./SlotCell";
import styles from "./pc.module.css";

export const COLUMNS = 6;
export const ROWS = 5;

interface Props {
  box: BoxDto;
  index: number;
  boxCount: number;
  currentBox: number | null;
  boxes: BoxDto[];
  scale: number;
  selected: string | null;
  over: string | null;
  grabRef: string | null;
  editable: boolean;
  flags: Record<string, "illegal" | "warning">;
  /** ¿Atenuar esta casilla? (filtro "solo ilegales") */
  isDim: (ref: string | null) => boolean;
  /** Ilegales por caja (para el selector). */
  illegalPerBox: Record<number, number>;
  onBox: (index: number) => void;
  onRename: (name: string) => void;
  onSelect: (dropRef: string) => void;
  onOpen: (ref: string) => void;
  dragProps: (ref: string) => { onPointerDown: (e: React.PointerEvent) => void };
  onCellKey: (e: React.KeyboardEvent, occupant: string | null, dropRef: string) => boolean;
  wasDragged: () => boolean;
  onContextMenu?: (e: React.MouseEvent, pk: PokemonSummary | null, dropRef: string) => void;
}

/** Una caja del PC como en los juegos: fondo del propio juego (box_N) o un patron de colores,
 *  rejilla 6x5 con el icono de cada Pokemon, nombre y flechas. */
export function BoxPanel(p: Props) {
  const { t } = useT();
  const ctx = useGame((s) => s.ctx);
  const gridRef = useRef<HTMLDivElement>(null);
  const [renaming, setRenaming] = useState(false);

  const bg = useMemo(() => (ctx ? resolveBoxBackground(ctx, p.box.background ?? p.index) : null), [ctx, p.box.background, p.index]);
  const geo = boxGeometry(bg?.w ?? 0, bg?.h ?? 0);
  const s = p.scale;
  const width = Math.round(geo.w * s);
  const height = Math.round(geo.h * s);
  const stepX = geo.stepX * s;
  const stepY = geo.stepY * s;
  const hue = (p.index * 47 + 20) % 360;
  const label = p.box.name || t("boxes.box", { n: p.index + 1 });

  // El primer elemento tabulable es el seleccionado de esta caja o, si no, la primera casilla.
  const selectedHere = p.selected?.startsWith(`box/${p.index}/`) ? p.selected : null;
  const tabRef = selectedHere ?? `box/${p.index}/0`;

  function focusCell(i: number) {
    const el = gridRef.current?.querySelector<HTMLElement>(`[data-cell="box/${p.index}/${i}"]`);
    el?.focus();
    p.onSelect(`box/${p.index}/${i}`);
  }

  function onKey(e: React.KeyboardEvent, pk: PokemonSummary | null, dropRef: string) {
    if (p.onCellKey(e, pk?.ref ?? null, dropRef)) return;
    const i = Number(dropRef.split("/")[2]);
    const col = i % COLUMNS;
    const row = Math.floor(i / COLUMNS);
    let next: number | null = null;
    switch (e.key) {
      case "ArrowLeft": next = col > 0 ? i - 1 : null; break;
      case "ArrowRight": next = col < COLUMNS - 1 ? i + 1 : null; break;
      case "ArrowUp": next = row > 0 ? i - COLUMNS : null; break;
      case "ArrowDown": next = row < ROWS - 1 ? i + COLUMNS : null; break;
      case "Home": next = row * COLUMNS; break;
      case "End": next = row * COLUMNS + COLUMNS - 1; break;
      case "PageUp": if (p.index > 0) { e.preventDefault(); p.onBox(p.index - 1); } return;
      case "PageDown": if (p.index < p.boxCount - 1) { e.preventDefault(); p.onBox(p.index + 1); } return;
      case "Enter": if (pk) { e.preventDefault(); p.onOpen(pk.ref); } return;
      default: return;
    }
    e.preventDefault();
    if (next != null) focusCell(next);
  }

  return (
    <div className={styles.boxWrap}>
      <div className={styles.boxHeader}>
        <Button size="sm" icon variant="secondary" data-nav="prev" disabled={p.index <= 0} onClick={() => p.onBox(p.index - 1)}
          aria-label={t("common.previous")} title={t("common.previous")}>
          <ChevronLeft size={16} />
        </Button>
        <div className={styles.boxSelect}>
          {renaming ? (
            <TextField value={p.box.name ?? ""} ariaLabel={t("pc.boxName")} placeholder={t("boxes.box", { n: p.index + 1 })}
              onCommit={(v) => { setRenaming(false); p.onRename(v ?? ""); }} />
          ) : (
            <SelectField value={p.index} ariaLabel={t("boxes.title")}
              options={p.boxes.map((b) => ({
                value: b.index,
                label: `${b.name || t("boxes.box", { n: b.index + 1 })} (${b.filled}${p.illegalPerBox[b.index] ? ` · ✗${p.illegalPerBox[b.index]}` : ""})`,
              }))}
              onChange={(v) => p.onBox(v)} />
          )}
        </div>
        {p.editable && (
          <Button size="sm" icon variant="ghost" onClick={() => setRenaming((r) => !r)} aria-label={t("pc.renameBox")} title={t("pc.renameBox")}>
            <Pencil size={15} />
          </Button>
        )}
        <Button size="sm" icon variant="secondary" data-nav="next" disabled={p.index >= p.boxCount - 1} onClick={() => p.onBox(p.index + 1)}
          aria-label={t("common.next")} title={t("common.next")}>
          <ChevronRight size={16} />
        </Button>
      </div>

      <div
        ref={gridRef}
        className={cx(styles.box, !bg && styles.boxFallback)}
        style={{ width, height, ["--box-hue" as string]: hue }}
        role="group"
        aria-label={`${label} — ${t("boxes.count", { count: p.box.filled })}`}
        data-testid="pc-box"
        data-box-art={bg ? "game" : "css"}
      >
        {bg && (
          <span className={styles.boxArt} aria-hidden="true">
            <GameImage rel={bg.path} size={height} frameRatio={bg.h > 0 ? bg.w / bg.h : 1} />
          </span>
        )}
        <div className={styles.boxName} style={{ top: Math.round(geo.originY * s * 0.1), fontSize: Math.max(8, Math.round(8 * s)) }} aria-hidden="true">
          {label}
        </div>
        {p.box.slots.map((pk, i) => {
          const col = i % COLUMNS;
          const row = Math.floor(i / COLUMNS);
          const dropRef = `box/${p.index}/${i}`;
          return (
            <SlotCell
              key={i}
              dropRef={dropRef}
              pk={pk}
              size={Math.round(stepX)}
              iconSize={Math.round(64 * s)}
              selected={p.selected === dropRef || (!!pk && p.selected === pk.ref)}
              grabbed={!!pk && p.grabRef === pk.ref}
              over={p.over === dropRef}
              dim={p.isDim(pk?.ref ?? null)}
              tabbable={tabRef === dropRef}
              style={{ position: "absolute", left: Math.round(geo.originX * s + col * stepX), top: Math.round(geo.originY * s + row * stepY), height: Math.round(stepY) }}
              onSelect={p.onSelect}
              onOpen={p.onOpen}
              onPointerDown={pk ? p.dragProps(pk.ref).onPointerDown : undefined}
              onKeyDown={onKey}
              wasDragged={p.wasDragged}
              onContextMenu={p.onContextMenu}
              flag={pk ? p.flags[pk.ref] ?? null : null}
            />
          );
        })}
      </div>
    </div>
  );
}
