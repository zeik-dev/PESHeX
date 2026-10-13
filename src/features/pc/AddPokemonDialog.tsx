import { useMemo, useState } from "react";
import type { PokemonImport } from "../../api/types";
import { STAT_IDS } from "../../api/types";
import type { SpeciesDetail } from "../../game/types";
import { useSpeciesOptions } from "../../game/useCatalog";
import { useT } from "../../lib/useT";
import { useEdit } from "../../stores/edit";
import { useGame } from "../../stores/game";
import { useSession } from "../../stores/session";
import { useToasts } from "../../stores/toasts";
import { Button, ComboBox, Field, Modal, NumberField, Switch, TextField } from "../../ui";
import { useSpeciesDetail } from "../pokemon/useSpeciesDetail";
import styles from "./pc.module.css";

/** Probabilidad de que sea hembra segun el ratio de genero del PBS (o `null` si solo hay un genero). */
const FEMALE_CHANCE: Record<string, number> = {
  FemaleOneEighth: 0.125, Female25Percent: 0.25, Female50Percent: 0.5, Female75Percent: 0.75, FemaleSevenEighths: 0.875,
};

function pickGender(ratio: string | null | undefined): number | null {
  if (ratio === "AlwaysMale") return 0;
  if (ratio === "AlwaysFemale") return 1;
  if (ratio === "Genderless") return 2;
  return Math.random() < (FEMALE_CHANCE[ratio ?? ""] ?? 0.5) ? 1 : 0;
}

/** Los ultimos (hasta) 4 movimientos que la especie aprende por nivel hasta `level`, sin repetir (como un salvaje). */
export function defaultMoves(detail: SpeciesDetail | undefined, level: number, max = 4): string[] {
  if (!detail) return [];
  const byLevel = detail.levelMoves.filter(([lv]) => lv >= 1 && lv <= level).sort((a, b) => a[0] - b[0]);
  const out: string[] = [];
  for (const [, id] of byLevel) {
    const at = out.indexOf(id);
    if (at >= 0) out.splice(at, 1); // si se repite, cuenta la ultima vez
    out.push(id);
  }
  return out.slice(-max);
}

/** Datos del Pokémon nuevo (`pokemon.add`): coherentes con la especie elegida (habilidad, genero, movimientos,
 *  felicidad) en lugar de heredar los de la plantilla del save. */
export function buildNewPokemon(opts: {
  species: string; form: number; level: number; nickname: string; shiny: boolean; maxIv: boolean; ivMax: number;
  detail: SpeciesDetail | undefined; legacy: boolean; maxMoves: number;
}): PokemonImport {
  const { detail, legacy } = opts;
  const data: PokemonImport = {
    species: opts.species,
    form: opts.form,
    level: opts.level,
    nickname: opts.nickname.trim() || null,
    shiny: opts.shiny,
    nature: "HARDY",
    iv: Object.fromEntries(STAT_IDS.map((s) => [s, opts.maxIv ? opts.ivMax : Math.floor(Math.random() * (opts.ivMax + 1))])),
    ev: Object.fromEntries(STAT_IDS.map((s) => [s, 0])),
    moves: defaultMoves(detail, opts.level, opts.maxMoves).map((id, slot) => ({ slot, id })),
    recalc: true,
  };
  if (detail?.info?.happiness != null) data.happiness = detail.info.happiness;
  const ability = detail?.abilities?.[0];
  if (ability) {
    data.ability = ability;
    if (!legacy) data.abilityIndex = 0; // v19+ guarda tambien el indice de la casilla
  }
  if (!legacy) {
    const gender = pickGender(detail?.genderRatio);
    if (gender != null) data.gender = gender;
  }
  return data;
}

/** Agregar un Pokémon nuevo en una casilla vacía del equipo o del PC, eligiendo la especie por nombre. */
export function AddPokemonDialog({ target, onClose, describe, onAdded }: {
  /** ref de la casilla vacia (`party/N` o `box/B/S`); `null` = cerrado. */
  target: string | null;
  onClose: () => void;
  describe: (ref: string) => string;
  onAdded: (ref: string) => void;
}) {
  const { t } = useT();
  const apply = useEdit((s) => s.apply);
  const busy = useEdit((s) => s.busy);
  const profile = useSession((s) => s.profile);
  const catalog = useGame((s) => s.catalog);
  const limits = useGame((s) => s.status.limits);
  const options = useSpeciesOptions();
  const [speciesId, setSpeciesId] = useState<string | null>(null);
  const [level, setLevel] = useState(5);
  const [nickname, setNickname] = useState("");
  const [shiny, setShiny] = useState(false);
  const [maxIv, setMaxIv] = useState(false);

  const entry = useMemo(() => catalog?.species.find((s) => s.id === speciesId) ?? null, [catalog, speciesId]);
  const base = entry?.species ?? (speciesId ? speciesId.replace(/_\d+$/, "") : null);
  const form = entry?.form ?? 0;
  const detail = useSpeciesDetail({ species: base ? { id: base, name: "" } : null, form });
  const maxLevel = limits?.maxLevel ?? 100;
  const legacy = profile?.idStyle === "integer";

  async function add() {
    if (!target || !base) return;
    const data = buildNewPokemon({
      species: base, form, level: Math.min(Math.max(level, 1), maxLevel), nickname, shiny, maxIv,
      ivMax: limits?.ivMax ?? 31, detail, legacy, maxMoves: limits?.maxMoves ?? 4,
    });
    const r = await apply([{ op: "pokemon.add", to: target, data }]);
    if (r?.applied) {
      useToasts.getState().push({ kind: "success", text: t("pc.add.added", { name: entry?.name ?? base, to: describe(target) }) });
      onAdded(target);
      setSpeciesId(null);
      setNickname("");
      onClose();
    }
  }

  return (
    <Modal
      open={!!target}
      title={t("pc.add.title")}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" disabled={!base || busy} onClick={() => void add()}>{t("pc.add.confirm")}</Button>
        </>
      }
    >
      <div className={styles.addForm}>
        {target && <p className="muted" style={{ margin: 0 }}>{t("pc.add.destination", { to: describe(target) })}</p>}
        <Field label={t("pokemon.species")} hint={options ? undefined : t("pc.add.noGame")}>
          {(id) =>
            options ? (
              <ComboBox id={id} value={speciesId} options={options} placeholder={t("pc.add.speciesPlaceholder")} onChange={setSpeciesId} />
            ) : (
              <TextField id={id} mono live value={speciesId ?? ""} placeholder="PIKACHU" onCommit={(v) => setSpeciesId(v ? v.trim().toUpperCase() : null)} />
            )
          }
        </Field>
        <Field label={t("pokemon.level")}>
          {(id) => <NumberField id={id} value={level} min={1} max={maxLevel} width={100} onCommit={setLevel} />}
        </Field>
        <Field label={t("pokemon.nickname")}>
          {(id) => <TextField id={id} value={nickname} placeholder={t("pokemon.nicknamePlaceholder")} onCommit={(v) => setNickname(v ?? "")} />}
        </Field>
        <label className={styles.addSwitch}>
          <Switch checked={maxIv} label={t("pc.add.maxIv")} onChange={setMaxIv} />
          {t("pc.add.maxIv")}
        </label>
        <label className={styles.addSwitch}>
          <Switch checked={shiny} label={t("pokemon.shiny")} onChange={setShiny} />
          {t("pokemon.shiny")}
        </label>
        <p className="muted" style={{ fontSize: 12, margin: 0 }}>{t("pc.add.help")}</p>
      </div>
    </Modal>
  );
}
