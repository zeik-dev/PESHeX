import { Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import type { PokemonDetail } from "../../api/types";
import { catEntry, internalId } from "../../game/lookup";
import type { SpeciesDetail } from "../../game/types";
import { useMoveOptions } from "../../game/useCatalog";
import { useT } from "../../lib/useT";
import { useGame } from "../../stores/game";
import { useHexMode, useSettings } from "../../stores/settings";
import { Button, CategoryIcon, ComboBox, EmptyState, Field, NumberField, Switch, TextField, TypeChip } from "../../ui";
import { usePatch } from "./editorShared";
import styles from "./pokemon.module.css";

/** Movimientos con tipo, categoría, potencia y PP del juego; con el filtro «solo los que aprende la especie» (HaX:
 *  interruptor activado por defecto; HeX: siempre filtrado). */
export function MovesTab({ pk, editable, species }: { pk: PokemonDetail; editable: boolean; species: SpeciesDetail | undefined }) {
  const { t } = useT();
  const hex = useHexMode();
  const patch = usePatch(pk.ref);
  const index = useGame((s) => s.catalogIndex);
  const onlyMoves = useSettings((s) => s.onlySpeciesMoves);
  const setOnlyMoves = useSettings((s) => s.setOnlySpeciesMoves);
  const [newId, setNewId] = useState<string | null>(null);

  const learnable = species?.learnable;
  const canFilter = !!learnable?.length;
  const filter = canFilter && (hex || onlyMoves);
  // Los movimientos que ya tiene siempre se ofrecen (si no, el selector enseñaría su id en bruto).
  const allowed = useMemo(() => {
    if (!filter || !learnable) return null;
    const own = pk.moves.map((m) => internalId(index, "moves", m.id)).filter((x): x is string => !!x);
    return new Set([...learnable, ...own]);
  }, [filter, learnable, pk.moves, index]);
  const moveOptions = useMoveOptions(allowed);
  const canAdd = editable && pk.moves.length < pk.limits.maxMoves;

  return (
    <div>
      {!hex && canFilter && (
        <label className={styles.filterSwitch} style={{ marginBottom: 10 }}>
          <Switch checked={onlyMoves} label={t("pokemon.onlySpeciesMoves")} onChange={setOnlyMoves} />
          {t("pokemon.onlySpeciesMoves")}
        </label>
      )}
      {pk.moves.length === 0 && <EmptyState>{t("pokemon.moves.empty")}</EmptyState>}
      {pk.moves.map((m) => {
        const entry = catEntry(index, "moves", m.id);
        const value = internalId(index, "moves", m.id);
        return (
          <div key={m.slot} className={styles.moveRow}>
            <div>
              <Field label={t("pokemon.moves.slot", { n: m.slot + 1 })}>
                {(id) =>
                  moveOptions ? (
                    <ComboBox id={id} value={value} options={moveOptions} allowCustom={!filter} limit={Infinity}
                      disabled={!editable} onChange={(v) => v && patch({ moves: [{ slot: m.slot, id: v }] })} />
                  ) : (
                    <TextField id={id} mono value={m.id == null ? "" : String(m.id)} disabled={!editable || typeof m.id === "number"}
                      onCommit={(v) => v && patch({ moves: [{ slot: m.slot, id: v }] })} />
                  )
                }
              </Field>
              {entry && (
                <div className={styles.moveInfo}>
                  {entry.type && <TypeChip id={entry.type} name={index?.types.get(entry.type)?.name} />}
                  <CategoryIcon category={entry.category} />
                  <span className="muted">
                    {entry.power ? t("pokemon.moves.power", { n: entry.power }) : null}
                    {entry.accuracy ? ` · ${t("pokemon.moves.accuracy", { n: entry.accuracy })}` : null}
                    {entry.pp ? ` · PP ${entry.pp}` : null}
                  </span>
                </div>
              )}
            </div>
            <Field label={t("pokemon.moves.pp")}>
              {(id) => <NumberField id={id} value={m.pp} min={0} max={entry?.pp ? entry.pp + 3 * Math.floor(entry.pp / 5) : pk.limits.ppMax} disabled={!editable || m.pp == null}
                onCommit={(n) => patch({ moves: [{ slot: m.slot, pp: n }] })} />}
            </Field>
            <Field label={t("pokemon.moves.ppUps")}>
              {(id) => <NumberField id={id} value={m.ppUps} min={0} max={3} disabled={!editable || m.ppUps == null}
                onCommit={(n) => patch({ moves: [{ slot: m.slot, ppUps: n }] })} />}
            </Field>
            <Button variant="ghost" size="sm" icon disabled={!editable} aria-label={t("common.remove")} title={t("common.remove")}
              onClick={() => patch({ moves: [{ slot: m.slot, remove: true }] })}>
              <Trash2 size={16} />
            </Button>
          </div>
        );
      })}
      {canAdd && (
        <div className={styles.moveRow} style={{ gridTemplateColumns: "1fr auto", borderBottom: 0 }}>
          <Field label={t("pokemon.moves.id")}>
            {(id) =>
              moveOptions ? (
                <ComboBox id={id} value={newId} options={moveOptions} allowCustom={!filter} limit={Infinity} placeholder="TACKLE" onChange={setNewId} />
              ) : (
                <TextField id={id} mono live value={newId ?? ""} placeholder="TACKLE" onCommit={(v) => setNewId(v ? v.toUpperCase() : null)} />
              )
            }
          </Field>
          <Button variant="primary" disabled={!newId?.trim()} onClick={() => { patch({ moves: [{ slot: pk.moves.length, id: newId!.trim() }] }); setNewId(null); }}>
            <Plus size={16} /> {t("pokemon.moves.add")}
          </Button>
        </div>
      )}
    </div>
  );
}
