import type { PokemonSummary } from "../../api/types";
import { useT } from "../../lib/useT";
import { SlotCell } from "./SlotCell";
import styles from "./pc.module.css";

interface Props {
  party: PokemonSummary[];
  limit: number;
  /** pc: bandeja compacta junto a la caja; party: rejilla grande del Equipo. */
  variant: "tray" | "grid";
  cell: number;
  selected: string | null;
  over: string | null;
  grabRef: string | null;
  flags: Record<string, "illegal" | "warning">;
  isDim: (ref: string | null) => boolean;
  onSelect: (dropRef: string) => void;
  onOpen: (ref: string) => void;
  dragProps: (ref: string) => { onPointerDown: (e: React.PointerEvent) => void };
  onCellKey: (e: React.KeyboardEvent, occupant: string | null, dropRef: string) => boolean;
  wasDragged: () => boolean;
  onContextMenu?: (e: React.MouseEvent, pk: PokemonSummary | null, dropRef: string) => void;
}

/** Equipo del jugador: seis casillas; si hay hueco se ofrece una casilla vacia al final
 *  (`party/N`) para meter un Pokemon desde una caja. */
export function PartyTray(p: Props) {
  const { t } = useT();
  const slots: (PokemonSummary | null)[] = [...p.party];
  if (slots.length < p.limit) slots.push(null);
  const selectedHere = p.selected && /^party\/\d+$/.test(p.selected) ? p.selected : null;
  const tabRef = selectedHere ?? "party/0";
  const grid = p.variant === "grid";

  function onKey(e: React.KeyboardEvent, pk: PokemonSummary | null, dropRef: string) {
    if (p.onCellKey(e, pk?.ref ?? null, dropRef)) return;
    const i = Number(dropRef.split("/")[1]);
    const cols = grid ? 2 : 2;
    let next: number | null = null;
    if (e.key === "ArrowDown") next = i + cols;
    else if (e.key === "ArrowUp") next = i - cols;
    else if (e.key === "ArrowRight") next = i + 1;
    else if (e.key === "ArrowLeft") next = i - 1;
    else if (e.key === "Enter" && pk) {
      e.preventDefault();
      p.onOpen(pk.ref);
      return;
    } else return;
    e.preventDefault();
    if (next != null && next >= 0 && next < slots.length) {
      document.querySelector<HTMLElement>(`[data-cell="party/${next}"]`)?.focus();
      p.onSelect(`party/${next}`);
    }
  }

  return (
    <section className={grid ? styles.partyGrid : styles.tray} aria-label={t("party.title")} role="group" data-testid="pc-party">
      {!grid && <div className={styles.trayTitle}>{t("party.title")}</div>}
      <div className={grid ? styles.partyGridInner : styles.trayInner}>
        {slots.map((pk, i) => {
          const dropRef = `party/${i}`;
          return (
            <SlotCell
              key={i}
              dropRef={dropRef}
              pk={pk}
              size={p.cell}
              iconSize={grid ? 72 : Math.round(p.cell * 0.9)}
              variant={grid ? "party" : "grid"}
              selected={p.selected === dropRef || (!!pk && p.selected === pk.ref)}
              grabbed={!!pk && p.grabRef === pk.ref}
              over={p.over === dropRef}
              dim={p.isDim(pk?.ref ?? null)}
              tabbable={tabRef === dropRef}
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
    </section>
  );
}
