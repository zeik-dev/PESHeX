import { useMemo } from "react";
import { PokemonDetail } from "../../api/types";
import { internalId, speciesEntry } from "../../game/lookup";
import type { SpeciesDetail } from "../../game/types";
import { speciesFormId, useAbilityOptions, useItemOptions, useSpeciesOptions } from "../../game/useCatalog";
import { NATURE_IDS, STATUS_IDS } from "../../lib/pokemon";
import { useT } from "../../lib/useT";
import { useEdit } from "../../stores/edit";
import { useGame } from "../../stores/game";
import { useHexMode, useSettings } from "../../stores/settings";
import { Chip, ComboBox, Field, NumberField, SelectField, SliderField, Switch, TextField } from "../../ui";
import { ItemPicker } from "../shared/ItemPicker";
import shared from "../shared/shared.module.css";
import { usePatch } from "./editorShared";
import styles from "./pokemon.module.css";

/** Pestaña General: identidad, nivel/felicidad/PS con deslizadores, naturaleza (y la de menta), habilidad, objeto y bola. */
export function GeneralTab({ pk, editable, species }: { pk: PokemonDetail; editable: boolean; species: SpeciesDetail | undefined }) {
  const { t, dyn, dynOr } = useT();
  const hex = useHexMode();
  const patch = usePatch(pk.ref);
  const apply = useEdit((s) => s.apply);
  const catalog = useGame((s) => s.catalog);
  const index = useGame((s) => s.catalogIndex);
  const onlyAbilities = useSettings((s) => s.onlySpeciesAbilities);
  const setOnlyAbilities = useSettings((s) => s.setOnlySpeciesAbilities);
  const speciesOptions = useSpeciesOptions();
  const ballOptions = useItemOptions(3);

  // Bases <= v18 guardan la habilidad como indice de casilla: solo caben las de la especie.
  const legacy = typeof pk.species?.id === "number";
  const allowed = useMemo(() => (species ? [...species.abilities, ...species.hiddenAbilities] : undefined), [species]);
  const canFilter = !!allowed?.length;
  const showFilterSwitch = !hex && !legacy && canFilter;
  const filter = canFilter && (hex || legacy || onlyAbilities);
  const abilityOptions = useAbilityOptions(allowed, filter, species?.hiddenAbilities);

  const natures = useMemo(
    () => (catalog?.natures.length ? catalog.natures : NATURE_IDS.map((id) => ({ id, up: null, down: null }))),
    [catalog],
  );
  const natureOptions = natures.map((n) => ({ value: n.id as string, label: dynOr("nature", n.id, n.id) }));
  const statusOptions = STATUS_IDS.map((s) => ({ value: s as string, label: dynOr("status", s, s) }));
  const natureText = (id: string | null | undefined) => {
    const n = natures.find((x) => x.id === id);
    if (!n) return null;
    return n.up && n.down ? `↑ ${dyn(`stat.${n.up}`)} · ↓ ${dyn(`stat.${n.down}`)}` : t("pokemon.natureNeutral");
  };
  const mint = pk.natureForStats?.id != null ? String(pk.natureForStats.id) : "";
  const effective = mint || (pk.nature ? String(pk.nature.id) : "");

  const speciesEditable = editable && (typeof pk.species?.id === "string" || !!speciesOptions);
  const speciesValue = speciesEntry(index, pk.species?.id, pk.form)?.id ?? speciesFormId(pk.species?.id, pk.form);
  const fainted = pk.hp === 0;

  return (
    <div className={shared.stack}>
      <div className={shared.formGrid2}>
        <Field label={t("pokemon.nickname")}>
          {(id) => (
            <TextField id={id} value={pk.nickname} nullable placeholder={t("pokemon.nicknamePlaceholder")} disabled={!editable}
              onCommit={(v) => patch({ nickname: v })} />
          )}
        </Field>
        <Field label={t("pokemon.species")}>
          {(id) =>
            speciesOptions ? (
              <ComboBox id={id} value={speciesValue} options={speciesOptions} disabled={!speciesEditable}
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
            <SliderField id={id} value={pk.level} min={1} max={pk.limits.maxLevel} disabled={!editable} ariaLabel={t("pokemon.level")}
              onCommit={(n) => void apply([{ op: "pokemon.level", ref: pk.ref, level: n }])} />
          )}
        </Field>
        <Field label={t("pokemon.happiness")}>
          {(id) => (
            <SliderField id={id} value={pk.happiness} min={0} max={pk.limits.happinessMax} disabled={!editable || pk.happiness == null}
              ariaLabel={t("pokemon.happiness")} onCommit={(n) => patch({ happiness: n })} />
          )}
        </Field>

        <Field label={t("pokemon.hp")} hint={t("pokemon.hpHint")}>
          {(id) => (
            <div className={styles.hpField}>
              <SliderField id={id} value={pk.hp} min={1} max={Math.max(1, pk.totalHp ?? 1)} numberMin={0} numberMax={pk.totalHp ?? undefined}
                disabled={!editable || pk.hp == null} ariaLabel={t("pokemon.hp")} onCommit={(n) => patch({ hp: n })} />
              {fainted && <Chip tone="bad">{t("pokemon.fainted")}</Chip>}
            </div>
          )}
        </Field>
        <Field label={t("pokemon.totalHp")}>
          {(id) => <NumberField id={id} value={pk.totalHp} disabled onCommit={() => undefined} />}
        </Field>

        <Field label={t("pokemon.nature")} hint={natureText(pk.nature ? String(pk.nature.id) : null) ?? undefined}>
          {(id) => (
            <SelectField id={id} value={pk.nature ? String(pk.nature.id) : null} options={natureOptions} disabled={!editable}
              onChange={(n) => patch({ nature: n })} />
          )}
        </Field>
        {pk.capabilities?.natureForStats ? (
          <Field label={t("pokemon.natureMint")} hint={mint ? (natureText(mint) ?? undefined) : t("pokemon.natureMintNone")}>
            {(id) => (
              <SelectField id={id} value={mint} disabled={!editable}
                options={[{ value: "", label: t("pokemon.natureMintOption") }, ...natureOptions]}
                onChange={(n) => patch({ natureForStats: n === "" ? null : n })} />
            )}
          </Field>
        ) : (
          <div />
        )}
        {effective && (
          <p className={styles.natureEffective} data-testid="nature-effective">
            {t("pokemon.natureEffective", { nature: dynOr("nature", effective, effective) })}
          </p>
        )}

        <Field label={t("pokemon.ability")}>
          {(id) =>
            abilityOptions ? (
              <ComboBox id={id} value={pk.ability ? String(pk.ability.id) : ""} options={abilityOptions} allowCustom={!filter}
                disabled={!editable} onChange={(v) => v && patch({ ability: v })} />
            ) : (
              <TextField id={id} mono value={pk.ability ? String(pk.ability.id) : ""} disabled={!editable}
                onCommit={(v) => v && patch({ ability: v })} />
            )
          }
        </Field>
        {showFilterSwitch ? (
          <label className={styles.filterSwitch}>
            <Switch checked={onlyAbilities} label={t("pokemon.onlySpeciesAbilities")} onChange={setOnlyAbilities} />
            {t("pokemon.onlySpeciesAbilities")}
          </label>
        ) : (
          <div />
        )}

        <Field label={t("pokemon.item")}>
          {(id) => (
            <ItemPicker id={id} value={pk.item?.id ?? null} onChange={(v) => patch({ item: v })} placeholder={t("pokemon.itemPlaceholder")} disabled={!editable} />
          )}
        </Field>
        <Field label={t("pokemon.ball")}>
          {(id) =>
            ballOptions ? (
              <ComboBox id={id} value={internalId(index, "items", pk.ballItem?.id ?? null)} options={ballOptions} disabled={!editable}
                onChange={(v) => v && patch({ ball: v })} />
            ) : (
              <TextField id={id} mono value={pk.ballItem?.name ?? (pk.ball == null ? "" : String(pk.ball))} disabled onCommit={() => undefined} />
            )
          }
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
        <Field label={t("pokemon.status")}>
          {(id) => (
            <SelectField id={id} value={pk.status == null ? null : String(pk.status)} options={statusOptions} disabled={!editable || pk.status == null}
              onChange={(s) => patch({ status: s })} />
          )}
        </Field>
      </div>
      <label className={styles.filterSwitch}>
        <Switch checked={pk.shiny} disabled={!editable} label={t("pokemon.shiny")} onChange={(v) => patch({ shiny: v })} />
        {t("pokemon.shiny")}
      </label>
    </div>
  );
}
