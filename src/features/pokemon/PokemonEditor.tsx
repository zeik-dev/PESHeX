import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { gameApi } from "../../api/game";
import { semantic } from "../../api/semantic";
import type { PokemonDetail, PokemonPatch, StatId } from "../../api/types";
import { STAT_IDS } from "../../api/types";
import { speciesFormId, useAbilityOptions, useItemOptions, useMoveOptions, useSpeciesOptions } from "../../game/useCatalog";
import { displayName, genderSymbol, NATURE_IDS, STATUS_IDS } from "../../lib/pokemon";
import { useT } from "../../lib/useT";
import { useEdit } from "../../stores/edit";
import { useGame } from "../../stores/game";
import { useSession } from "../../stores/session";
import {
  Banner, Button, Chip, ComboBox, Drawer, EmptyState, Field, NumberField, PokeballSpinner, PokemonIcon, SelectField, StatBar,
  Switch, Tabs, TextField,
} from "../../ui";
import { FlagList } from "../legality/FlagList";
import { LegalityBadge } from "../legality/LegalityBadge";
import { ExtrasList } from "../shared/ExtrasList";
import shared from "../shared/shared.module.css";
import { useSemanticQuery } from "../queries";
import styles from "./pokemon.module.css";

type Tab = "general" | "stats" | "moves" | "legality" | "info";

/** Panel lateral con el editor del Pokemon seleccionado (equipo o PC). */
export function PokemonEditorHost() {
  const { t } = useT();
  const ref = useSession((s) => s.editorRef);
  const close = useSession((s) => s.closeEditor);
  return (
    <Drawer open={!!ref} title={t("nav.party")} onClose={close}>
      {ref && <PokemonEditor key={ref} ref_={ref} />}
    </Drawer>
  );
}

function PokemonEditor({ ref_ }: { ref_: string }) {
  const { t } = useT();
  const profile = useSession((s) => s.profile);
  const q = useSemanticQuery(["pokemon", ref_], () => semantic.pokemon(ref_));
  const [tab, setTab] = useState<Tab>("general");

  if (q.isError) return <EmptyState>{String((q.error as { message?: string })?.message ?? "")}</EmptyState>;
  if (!q.data) return <div style={{ padding: 24 }}><PokeballSpinner /></div>;
  const pk = q.data;
  const editable = profile?.editable ?? false;

  return (
    <div>
      <div className={styles.head}>
        <PokemonIcon name={displayName(pk)} species={pk.species?.id ?? 0} form={pk.form} gender={pk.gender} shiny={pk.shiny} egg={pk.egg} size={84} />
        <div style={{ minWidth: 0 }}>
          <div className={styles.title}>
            {displayName(pk)} <span style={{ color: "var(--accent)" }}>{genderSymbol(pk.gender)}</span>
          </div>
          <div className="muted">
            {pk.species?.name}
            {pk.level != null && ` · ${t("party.level", { level: pk.level })}`}
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
            <Chip>{pk.ref}</Chip>
            {pk.shiny && <Chip tone="warn">★ {t("party.shiny")}</Chip>}
          </div>
        </div>
      </div>

      <div className={styles.body}>
        {pk.shared.length > 0 && (
          <Banner tone="info" title={t("banner.sharedTitle")}>
            {t("banner.sharedBody", { paths: pk.shared.join(", ") })}
          </Banner>
        )}
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { id: "general", label: t("pokemon.tabs.general") },
            { id: "stats", label: t("pokemon.tabs.stats") },
            { id: "moves", label: t("pokemon.tabs.moves"), badge: pk.moves.length },
            { id: "legality", label: t("legality.tab"), badge: pk.flags.filter((f) => f.severity !== "info").length || undefined },
            { id: "info", label: t("pokemon.tabs.info") },
          ]}
        />
        {tab === "general" && <General pk={pk} editable={editable} />}
        {tab === "stats" && <Stats pk={pk} editable={editable} />}
        {tab === "moves" && <Moves pk={pk} editable={editable} />}
        {tab === "legality" && (
          <div className={shared.stack}>
            <LegalityBadge flags={pk.flags} />
            {pk.flags.length > 0 && <FlagList flags={pk.flags} />}
          </div>
        )}
        {tab === "info" && <Info pk={pk} editable={editable} />}
      </div>
    </div>
  );
}

function usePatch(ref: string) {
  const apply = useEdit((s) => s.apply);
  return (patch: PokemonPatch) => void apply([{ op: "pokemon.patch", ref, patch }]);
}

function General({ pk, editable }: { pk: PokemonDetail; editable: boolean }) {
  const { t, dynOr } = useT();
  const patch = usePatch(pk.ref);
  const speciesEditable = editable && typeof pk.species?.id === "string";
  const linked = useGame((s) => s.status.linked);
  const speciesOptions = useSpeciesOptions();
  const itemOptions = useItemOptions();
  const speciesQ = useSemanticQuery(
    ["species", pk.species?.id, pk.form],
    () => gameApi.species(String(pk.species?.id), pk.form ?? 0),
    linked && typeof pk.species?.id === "string",
  );
  const abilityOptions = useAbilityOptions(
    speciesQ.data ? [...speciesQ.data.abilities, ...speciesQ.data.hiddenAbilities] : undefined,
  );
  const natureOptions = NATURE_IDS.map((n) => ({ value: n as string, label: dynOr("nature", n, n) }));
  const statusOptions = STATUS_IDS.map((s) => ({ value: s as string, label: dynOr("status", s, s) }));

  return (
    <div className={shared.stack}>
      <div className={shared.formGrid}>
        <Field label={t("pokemon.nickname")}>
          {(id) => (
            <TextField id={id} value={pk.nickname} nullable placeholder={t("pokemon.nicknamePlaceholder")} disabled={!editable}
              onCommit={(v) => patch({ nickname: v })} />
          )}
        </Field>
        <Field label={t("pokemon.species")}>
          {(id) =>
            speciesOptions ? (
              <ComboBox id={id} value={speciesFormId(pk.species?.id, pk.form)} options={speciesOptions} disabled={!speciesEditable}
                allowCustom onChange={(v) => {
                  if (!v) return;
                  const o = useGame.getState().catalog?.species.find((x) => x.id === v);
                  patch(o ? { species: o.species, form: o.form } : { species: v });
                }} />
            ) : (
              <TextField id={id} mono value={pk.species ? String(pk.species.id) : ""} disabled={!speciesEditable}
                onCommit={(v) => v && patch({ species: v })} />
            )
          }
        </Field>
        <Field label={t("pokemon.level")} hint={t("pokemon.levelNote")}>
          {(id) => (
            <NumberField id={id} value={pk.level} min={1} max={pk.limits.maxLevel} disabled={!editable}
              onCommit={(n) => patch({ level: n })} />
          )}
        </Field>
        <Field label={t("pokemon.exp")}>
          {(id) => <NumberField id={id} value={pk.exp} min={0} disabled={!editable || pk.exp == null} onCommit={(n) => patch({ exp: n })} />}
        </Field>
        <Field label={t("pokemon.gender")}>
          {(id) => (
            <SelectField id={id} value={pk.gender} disabled={!editable || pk.gender == null}
              options={[0, 1, 2].map((g) => ({ value: g, label: t(`gender.${g}` as never) as string }))}
              onChange={(g) => patch({ gender: g })} />
          )}
        </Field>
        <Field label={t("pokemon.nature")}>
          {(id) => (
            <SelectField id={id} value={pk.nature ? String(pk.nature.id) : null} options={natureOptions} disabled={!editable}
              onChange={(n) => patch({ nature: n })} />
          )}
        </Field>
        <Field label={t("pokemon.ability")}>
          {(id) =>
            abilityOptions ? (
              <ComboBox id={id} value={pk.ability ? String(pk.ability.id) : ""} options={abilityOptions} allowCustom
                disabled={!editable || typeof pk.ability?.id === "number"} onChange={(v) => v && patch({ ability: v })} />
            ) : (
              <TextField id={id} mono value={pk.ability ? String(pk.ability.id) : ""} disabled={!editable || typeof pk.ability?.id === "number"}
                onCommit={(v) => v && patch({ ability: v })} />
            )
          }
        </Field>
        <Field label={t("pokemon.item")}>
          {(id) =>
            itemOptions ? (
              <ComboBox id={id} value={pk.item ? String(pk.item.id) : ""} options={itemOptions} allowCustom nullable
                placeholder={t("pokemon.itemPlaceholder")} disabled={!editable} onChange={(v) => patch({ item: v })} />
            ) : (
              <TextField id={id} mono nullable value={pk.item ? String(pk.item.id) : ""} placeholder={t("pokemon.itemPlaceholder")} disabled={!editable}
                onCommit={(v) => patch({ item: v })} />
            )
          }
        </Field>
        <Field label={t("pokemon.happiness")}>
          {(id) => (
            <NumberField id={id} value={pk.happiness} min={0} max={pk.limits.happinessMax} disabled={!editable || pk.happiness == null}
              onCommit={(n) => patch({ happiness: n })} />
          )}
        </Field>
        <Field label={t("pokemon.status")}>
          {(id) => (
            <SelectField id={id} value={pk.status == null ? null : String(pk.status)} options={statusOptions} disabled={!editable || pk.status == null}
              onChange={(s) => patch({ status: s })} />
          )}
        </Field>
        <Field label={t("pokemon.hp")}>
          {(id) => <NumberField id={id} value={pk.hp} min={0} max={pk.totalHp ?? undefined} disabled={!editable || pk.hp == null} onCommit={(n) => patch({ hp: n })} />}
        </Field>
        <Field label={t("pokemon.totalHp")}>
          {(id) => <NumberField id={id} value={pk.totalHp} disabled onCommit={() => undefined} />}
        </Field>
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Switch checked={pk.shiny} disabled={!editable} label={t("pokemon.shiny")} onChange={(v) => patch({ shiny: v })} />
        {t("pokemon.shiny")}
      </label>
    </div>
  );
}

function Stats({ pk, editable }: { pk: PokemonDetail; editable: boolean }) {
  const { t, dyn } = useT();
  const patch = usePatch(pk.ref);
  const lim = pk.limits;
  const setAll = (key: "iv" | "ev", value: number) =>
    patch({ [key]: Object.fromEntries(STAT_IDS.map((s) => [s, value])) } as PokemonPatch);

  const block = (key: "iv" | "ev", max: number) => (
    <div>
      <div className={styles.sectionLabel}>{t(`pokemon.${key}`)}</div>
      {STAT_IDS.map((s: StatId) => (
        <div key={s} className={styles.statRow}>
          <span className={styles.statName}>{dyn(`stat.${s}`)}</span>
          <StatBar value={pk[key][s]} max={max} label={`${key.toUpperCase()} ${dyn(`stat.${s}`)}`} />
          <NumberField value={pk[key][s]} min={0} max={max} disabled={!editable || pk[key][s] == null}
            ariaLabel={`${key.toUpperCase()} ${dyn(`stat.${s}`)}`}
            onCommit={(n) => patch({ [key]: { [s]: n } } as PokemonPatch)} />
        </div>
      ))}
    </div>
  );

  return (
    <div>
      <div className={styles.sectionLabel}>{t("pokemon.quick.title")}</div>
      <div className={styles.quick}>
        <Button size="sm" disabled={!editable} onClick={() => setAll("iv", lim.ivMax)}>{t("pokemon.quick.perfectIv")}</Button>
        <Button size="sm" disabled={!editable} onClick={() => setAll("iv", 0)}>{t("pokemon.quick.clearIv")}</Button>
        <Button size="sm" disabled={!editable} onClick={() => setAll("ev", 0)}>{t("pokemon.quick.clearEv")}</Button>
        <Button size="sm" disabled={!editable}
          onClick={() => patch({ ev: { HP: 6, ATTACK: 252, DEFENSE: 0, SPECIAL_ATTACK: 0, SPECIAL_DEFENSE: 0, SPEED: 252 } })}>
          {t("pokemon.quick.spread252")}
        </Button>
      </div>
      {block("iv", lim.ivMax)}
      {block("ev", lim.evStatMax)}
      <div className={styles.total}>
        <strong>{t("pokemon.evTotal")}</strong>
        <Chip tone={pk.evTotal > lim.evTotalMax ? "warn" : "good"}>
          {t("pokemon.evTotalLimit", { total: pk.evTotal, max: lim.evTotalMax })}
        </Chip>
      </div>
      <div className={styles.sectionLabel}>{t("pokemon.cachedStats")}</div>
      <div className={styles.cached}>
        {STAT_IDS.map((s) => (
          <div key={s} className={styles.cachedItem}>
            <span className="muted">{dyn(`stat.${s}`)}</span>
            <strong>{pk.stats.cached[s] ?? "—"}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function Moves({ pk, editable }: { pk: PokemonDetail; editable: boolean }) {
  const { t } = useT();
  const patch = usePatch(pk.ref);
  const [newId, setNewId] = useState("");
  const moveOptions = useMoveOptions();
  const canAdd = editable && pk.moves.length < pk.limits.maxMoves;

  return (
    <div>
      {pk.moves.length === 0 && <EmptyState>{t("pokemon.moves.empty")}</EmptyState>}
      {pk.moves.map((m) => (
        <div key={m.slot} className={styles.moveRow}>
          <Field label={t("pokemon.moves.slot", { n: m.slot + 1 })} hint={m.name && m.name !== String(m.id) ? m.name : undefined}>
            {(id) =>
              moveOptions ? (
                <ComboBox id={id} value={m.id == null ? "" : String(m.id)} options={moveOptions} allowCustom
                  disabled={!editable || typeof m.id === "number"} onChange={(v) => v && patch({ moves: [{ slot: m.slot, id: v }] })} />
              ) : (
                <TextField id={id} mono value={m.id == null ? "" : String(m.id)} disabled={!editable || typeof m.id === "number"}
                  onCommit={(v) => v && patch({ moves: [{ slot: m.slot, id: v }] })} />
              )
            }
          </Field>
          <Field label={t("pokemon.moves.pp")}>
            {(id) => <NumberField id={id} value={m.pp} min={0} max={pk.limits.ppMax} disabled={!editable || m.pp == null}
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
      ))}
      {canAdd && (
        <div className={styles.moveRow} style={{ gridTemplateColumns: "1fr auto", borderBottom: 0 }}>
          <Field label={t("pokemon.moves.id")}>
            {(id) =>
              moveOptions ? (
                <ComboBox id={id} value={newId} options={moveOptions} allowCustom placeholder="TACKLE" onChange={(v) => setNewId(v ?? "")} />
              ) : (
                <input id={id} className="mono" style={{ minHeight: 36, padding: "0 12px", border: "1px solid var(--border)", borderRadius: 8, background: "var(--surface)", color: "var(--text)", width: "100%" }}
                  value={newId} placeholder="TACKLE" onChange={(e) => setNewId(e.target.value.toUpperCase())} />
              )
            }
          </Field>
          <Button variant="primary" disabled={!newId.trim()} onClick={() => { patch({ moves: [{ slot: pk.moves.length, id: newId.trim() }] }); setNewId(""); }}>
            <Plus size={16} /> {t("pokemon.moves.add")}
          </Button>
        </div>
      )}
    </div>
  );
}

function Info({ pk, editable }: { pk: PokemonDetail; editable: boolean }) {
  const { t } = useT();
  const vanilla = pk.extras.filter((e) => !e.custom);
  const custom = pk.extras.filter((e) => e.custom);
  return (
    <div className={shared.stack}>
      <div className={shared.kv}>
        <span className={shared.kvLabel}>{t("pokemon.info.owner")}</span>
        <span className={shared.kvValue}>{pk.owner?.name ?? "—"}{pk.owner?.id != null ? ` (${pk.owner.id})` : ""}</span>
        <span className={shared.kvLabel}>{t("pokemon.info.personalId")}</span>
        <span className={shared.kvValue}>{pk.personalId ?? "—"}</span>
        <span className={shared.kvLabel}>{t("pokemon.info.path")}</span>
        <span className={shared.kvValue + " mono"}>{pk.fieldPath}</span>
      </div>
      {custom.length > 0 && (
        <div>
          <div className={styles.sectionLabel}>{t("pokemon.info.customs")}</div>
          <ExtrasList ref_={pk.ref} extras={custom} readOnly={!editable} />
        </div>
      )}
      {vanilla.length > 0 && (
        <div>
          <div className={styles.sectionLabel}>{t("pokemon.info.others")}</div>
          <ExtrasList ref_={pk.ref} extras={vanilla} readOnly={!editable} />
        </div>
      )}
    </div>
  );
}
