import { X } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { gameApi } from "../../api/game";
import { toApiError } from "../../api/tauri";
import { STAT_IDS } from "../../api/types";
import { norm } from "../../game/normalize";
import type { SpeciesDetail, SpeciesEvolution, SpeciesExtras } from "../../game/types";
import { prettyId } from "../../game/useCatalog";
import { errorText } from "../../lib/errors";
import { evoParamKind, groupEncounters, humanizeMethod, levelRange } from "../../lib/evolution";
import { genderLabel, statTotal } from "../../lib/speciesInfo";
import { typeMatchups } from "../../lib/typeChart";
import { useT } from "../../lib/useT";
import { useGame } from "../../stores/game";
import { Banner, Button, CategoryIcon, Chip, ItemIcon, PokemonIcon, PokeballSpinner, StatBar, Tabs, TypeChip } from "../../ui";
import { useSemanticQuery } from "../queries";
import styles from "./pokedex.module.css";

type MoveTab = "level" | "tm" | "tutor" | "egg";

/** Consulta de la ficha (comparte clave con la del editor de Pokémon): sin datos mientras llega otra especie. Un fallo se
 *  muestra (con «Reintentar») en vez de dejar el spinner para siempre. */
function useSpecies(id: string, form: number) {
  const q = useSemanticQuery<SpeciesDetail>(["species", id, form], () => gameApi.species(id, form), true, { retry: 1 });
  return { data: q.isPlaceholderData ? undefined : q.data, error: q.isError ? toApiError(q.error) : null, refetch: q.refetch };
}

/** Zonas y numeración regional: se piden DESPUÉS de la ficha y con la especie estable (`enabled`): el driver Ruby atiende
 *  una petición cada vez y un extras lento no debe retrasar la ficha de la siguiente especie. */
function useExtras(id: string, form: number, enabled: boolean) {
  const q = useSemanticQuery<SpeciesExtras>(["species-extras", id, form], () => gameApi.speciesExtras(id, form), enabled, { retry: 1 });
  return { data: q.isPlaceholderData ? undefined : q.data, error: q.isError ? toApiError(q.error) : null, refetch: q.refetch };
}

/** Espera de cortesía antes de pedir los extras tras abrir una ficha (ms) y aviso de lentitud (ms). */
const EXTRAS_SETTLE_MS = 250;
const SLOW_MS = 8_000;

function Section({ title, children, testId }: { title: string; children: ReactNode; testId?: string }) {
  return (
    <section className={styles.sec} data-testid={testId}>
      <h3 className={styles.secTitle}>{title}</h3>
      {children}
    </section>
  );
}

/** Ficha de una especie: datos del PBS / `.dat` del juego vinculado (nada de esto viene del save). */
export function SpeciesSheet({ speciesId, onSelect, onClose }: { speciesId: string; onSelect: (id: string) => void; onClose: () => void }) {
  const { t, dyn, locale } = useT();
  const { i18n } = useTranslation();
  const catalog = useGame((s) => s.catalog);
  const index = useGame((s) => s.catalogIndex);
  const [form, setForm] = useState(0);
  const [moveTab, setMoveTab] = useState<MoveTab>("level");
  const [moveFilter, setMoveFilter] = useState("");
  const detailQ = useSpecies(speciesId, form);
  const detail = detailQ.data;
  const [settled, setSettled] = useState(false);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    setSettled(false);
    if (!detail) return;
    const timer = setTimeout(() => setSettled(true), EXTRAS_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [detail?.id, detail?.form]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setSlow(false);
    if (detail || detailQ.error) return;
    const timer = setTimeout(() => setSlow(true), SLOW_MS);
    return () => clearTimeout(timer);
  }, [speciesId, form, detail, detailQ.error]);
  const extrasQ = useExtras(speciesId, form, !!detail && settled);
  const extras = extrasQ.data;
  const num = (n: number) => n.toLocaleString(locale, { maximumFractionDigits: 1 });
  const has = (key: string) => i18n.exists(key);
  /** Traducción por clave con respaldo (los valores del PBS son enums en inglés: se traducen los conocidos). */
  const pretty = (prefix: string, id: string | null | undefined) => (id ? (has(`${prefix}.${id}`) ? dyn(`${prefix}.${id}`) : humanizeMethod(id)) : "");

  const name = detail?.name ?? index?.species.get(speciesId)?.name ?? prettyId(speciesId);
  const matchups = useMemo(() => (detail && catalog ? typeMatchups(detail.types, catalog.types) : null), [detail, catalog]);

  if (!detail) {
    return (
      <aside className={styles.sheet} aria-label={t("pokedex.sheet.label")} data-testid="species-sheet" data-state={detailQ.error ? "error" : "loading"}>
        <div className={styles.sheetHead}>
          <strong>{name}</strong>
          <Button variant="ghost" size="sm" icon onClick={onClose} aria-label={t("pokedex.sheet.close")} title={t("pokedex.sheet.close")}><X size={16} /></Button>
        </div>
        {detailQ.error ? (
          <Banner tone="bad" title={t("pokedex.sheet.error")} action={<Button size="sm" onClick={() => void detailQ.refetch()}>{t("pokedex.sheet.retry")}</Button>}>
            <span data-testid="sheet-error">{errorText(t, detailQ.error)}</span>
          </Banner>
        ) : (
          <>
            <PokeballSpinner label={t("pokedex.sheet.loading")} />
            {slow && (
              <Banner tone="warn" title={t("pokedex.sheet.slow")} action={<Button size="sm" onClick={() => void detailQ.refetch()}>{t("pokedex.sheet.retry")}</Button>}>
                {t("pokedex.sheet.slowBody")}
              </Banner>
            )}
          </>
        )}
      </aside>
    );
  }

  const info = detail.info ?? {};
  const base = detail.baseStats;
  const typeName = (id: string) => index?.types.get(id)?.name;
  const moveName = (id: string) => index?.moves.get(id)?.name ?? prettyId(id);
  const itemName = (id: string) => index?.items.get(id)?.name ?? prettyId(id);
  const speciesName = (id: string) => index?.species.get(id)?.name ?? prettyId(id);

  const evoText = (e: SpeciesEvolution): string => {
    const kind = evoParamKind(e.method, e.param);
    const raw = e.param == null ? "" : String(e.param);
    const p = { number: raw, item: itemName(raw), move: moveName(raw), type: typeName(raw) ?? prettyId(raw), species: speciesName(raw), raw, none: "" }[kind];
    const key = `pokedex.evo.m.${e.method}`;
    if (has(key)) return dyn(key, { p });
    return p ? `${humanizeMethod(e.method)}: ${p}` : humanizeMethod(e.method);
  };

  const growth = detail.growthRate ? pretty("pokedex.growth", detail.growthRate) : null;
  const gender = genderLabel(detail.genderRatio, num);
  const evYield = Object.entries(info.evYield ?? {}).filter(([, n]) => n > 0);
  const wild = (["common", "uncommon", "rare"] as const).flatMap((k) => (info.wildItems?.[k] ?? []).map((id) => ({ id, rarity: k })));

  const moves: { level: number | null; id: string }[] = (
    {
      level: detail.levelMoves.map(([lv, id]) => ({ level: lv, id })),
      tm: (detail.tmMoves ?? []).map((id) => ({ level: null, id })),
      tutor: detail.tutorMoves.map((id) => ({ level: null, id })),
      egg: detail.eggMoves.map((id) => ({ level: null, id })),
    } satisfies Record<MoveTab, { level: number | null; id: string }[]>
  )[moveTab];
  const needle = norm(moveFilter);
  const shownMoves = moves.filter((m) => !needle || norm(moveName(m.id)).includes(needle) || norm(m.id).includes(needle));
  const tabCount = { level: detail.levelMoves.length, tm: detail.tmMoves?.length ?? 0, tutor: detail.tutorMoves.length, egg: detail.eggMoves.length };

  const next = detail.evolutions.filter((e) => !e.prevo);
  const groups = groupEncounters(extras?.encounters ?? []);
  const regional = Object.entries(extras?.regional ?? {});
  const forms = detail.forms ?? [];
  const sheetForm = forms.find((f) => f.form === form);

  const speciesLink = (id: string) => (
    <button key={id} type="button" className={styles.link} onClick={() => onSelect(id)}>
      <PokemonIcon name={speciesName(id)} species={id} size={28} /> {speciesName(id)}
    </button>
  );

  return (
    <aside className={styles.sheet} aria-label={t("pokedex.sheet.label")} data-testid="species-sheet">
      <div className={styles.sheetHead}>
        <PokemonIcon name={name} species={detail.species} form={form} number={detail.number ?? undefined} size={72} />
        <div className={styles.sheetTitle}>
          <div className={styles.sheetName}>{name}{detail.formName && form > 0 ? <span className="muted"> · {detail.formName}</span> : null}</div>
          <div className="muted mono" style={{ fontSize: 12 }}>
            {(detail.number ?? detail.order) != null && `#${String(detail.number ?? detail.order).padStart(3, "0")}`}
            {info.category ? ` · ${info.category}` : ""}
          </div>
          <div className={styles.chips}>{detail.types.map((ty) => <TypeChip key={ty} id={ty} name={typeName(ty)} />)}</div>
        </div>
        <Button variant="ghost" size="sm" icon onClick={onClose} aria-label={t("pokedex.sheet.close")} title={t("pokedex.sheet.close")}><X size={16} /></Button>
      </div>

      {forms.length > 0 && (
        <div className={styles.chips} role="group" aria-label={t("pokedex.sheet.forms")}>
          <button type="button" className={styles.formChip} aria-pressed={form === 0} onClick={() => setForm(0)}>{t("pokedex.sheet.formBase")}</button>
          {forms.map((f) => (
            <button key={f.form} type="button" className={styles.formChip} aria-pressed={form === f.form} onClick={() => setForm(f.form)}>
              {f.formName ?? `#${f.form}`}
            </button>
          ))}
        </div>
      )}

      {detail.warnings && detail.warnings.length > 0 && (
        <p className="muted" style={{ fontSize: 12, margin: 0 }} title={detail.warnings.join("\n")} data-testid="sheet-warnings">
          {t("pokedex.sheet.partial")}
        </p>
      )}

      {info.pokedex && <p className={styles.entry}>{info.pokedex}</p>}

      <Section title={t("pokedex.sheet.baseStats")} testId="sheet-stats">
        <div className={styles.statRows}>
          {STAT_IDS.map((s) => (
            <div key={s} className={styles.statRow}>
              <span className="muted">{dyn(`stat.${s}`)}</span>
              <StatBar value={base[s]} max={255} label={`${t("pokedex.sheet.baseStats")}: ${dyn(`stat.${s}`)}`} />
              <strong className="mono">{base[s] ?? "—"}</strong>
            </div>
          ))}
          <div className={styles.statRow}>
            <span className="muted">{t("pokedex.sheet.total")}</span>
            <span />
            <strong className="mono">{statTotal(base)}</strong>
          </div>
        </div>
      </Section>

      <Section title={t("pokedex.sheet.abilities")}>
        <ul className={styles.plain}>
          {[...detail.abilities.map((id) => ({ id, hidden: false })), ...detail.hiddenAbilities.map((id) => ({ id, hidden: true }))].map((a) => {
            const ab = index?.abilities.get(a.id);
            return (
              <li key={`${a.id}-${a.hidden}`}>
                <strong>{ab?.name ?? prettyId(a.id)}</strong>{" "}
                {a.hidden && <Chip tone="info">{t("pokedex.sheet.hidden")}</Chip>}
                {ab?.description && <div className="muted" style={{ fontSize: 12 }}>{ab.description}</div>}
              </li>
            );
          })}
        </ul>
      </Section>

      {matchups && (
        <Section title={t("pokedex.sheet.types")} testId="sheet-types">
          {(["x4", "x2", "half", "quarter", "immune"] as const).map((k) =>
            matchups[k].length > 0 ? (
              <div key={k} className={styles.matchRow}>
                <span className={styles.matchLabel}>{t(`pokedex.sheet.match.${k}`)}</span>
                <span className={styles.chips}>{matchups[k].map((ty) => <TypeChip key={ty} id={ty} name={typeName(ty)} />)}</span>
              </div>
            ) : null,
          )}
        </Section>
      )}

      <Section title={t("pokedex.sheet.info")}>
        <dl className={styles.kv}>
          {info.height != null && (<><dt>{t("pokedex.sheet.height")}</dt><dd>{num(info.height)} m</dd></>)}
          {info.weight != null && (<><dt>{t("pokedex.sheet.weight")}</dt><dd>{num(info.weight)} kg</dd></>)}
          {gender ? (<><dt>{t("pokedex.sheet.gender")}</dt><dd>{gender}</dd></>) : detail.genderRatio ? (<><dt>{t("pokedex.sheet.gender")}</dt><dd>{t("pokedex.sheet.genderless")}</dd></>) : null}
          {info.color && (<><dt>{t("pokedex.sheet.color")}</dt><dd>{pretty("pokedex.color", info.color)}</dd></>)}
          {info.shape && (<><dt>{t("pokedex.sheet.shape")}</dt><dd>{humanizeMethod(info.shape)}</dd></>)}
          {info.habitat && (<><dt>{t("pokedex.sheet.habitat")}</dt><dd>{pretty("pokedex.habitat", info.habitat)}</dd></>)}
          {info.generation != null && (<><dt>{t("pokedex.sheet.generation")}</dt><dd>{info.generation}</dd></>)}
          {info.eggGroups && info.eggGroups.length > 0 && (<><dt>{t("pokedex.sheet.eggGroups")}</dt><dd>{info.eggGroups.map((g) => pretty("pokedex.eggGroup", g)).join(", ")}</dd></>)}
          {info.hatchSteps != null && (<><dt>{t("pokedex.sheet.hatchSteps")}</dt><dd>{info.hatchSteps.toLocaleString(locale)}</dd></>)}
          {info.catchRate != null && (<><dt>{t("pokedex.sheet.catchRate")}</dt><dd>{info.catchRate}</dd></>)}
          {info.happiness != null && (<><dt>{t("pokedex.sheet.happiness")}</dt><dd>{info.happiness}</dd></>)}
          {info.baseExp != null && (<><dt>{t("pokedex.sheet.baseExp")}</dt><dd>{info.baseExp}</dd></>)}
          {growth && (<><dt>{t("pokedex.sheet.growth")}</dt><dd>{growth}</dd></>)}
          {evYield.length > 0 && (<><dt>{t("pokedex.sheet.evYield")}</dt><dd>{evYield.map(([s, n]) => `+${n} ${dyn(`stat.${s}`)}`).join(", ")}</dd></>)}
          {wild.length > 0 && (
            <>
              <dt>{t("pokedex.sheet.wildItems")}</dt>
              <dd className={styles.chips}>
                {wild.map((w) => (
                  <span key={`${w.rarity}-${w.id}`} className={styles.itemTag} title={t(`pokedex.sheet.wild.${w.rarity}`)}>
                    <ItemIcon item={{ id: w.id }} size={20} /> {itemName(w.id)} <span className="muted">· {t(`pokedex.sheet.wild.${w.rarity}`)}</span>
                  </span>
                ))}
              </dd>
            </>
          )}
        </dl>
      </Section>

      <Section title={t("pokedex.sheet.evolution")} testId="sheet-evolution">
        {detail.prevos.length > 0 && (
          <div className={styles.evoRow}>
            <span className={styles.matchLabel}>{t("pokedex.sheet.evolvesFrom")}</span>
            <span className={styles.chips}>{[...detail.prevos].reverse().map(speciesLink)}</span>
          </div>
        )}
        {next.length > 0 ? (
          <ul className={styles.plain}>
            {next.map((e, i) => (
              <li key={`${e.species}-${e.method}-${i}`} className={styles.evoRow}>
                {speciesLink(e.species)}
                <span className="muted" style={{ fontSize: 12 }}>{evoText(e)}</span>
              </li>
            ))}
          </ul>
        ) : (
          detail.prevos.length === 0 && <p className="muted">{t("pokedex.sheet.noEvolution")}</p>
        )}
        {sheetForm?.mega && (sheetForm.mega.stone || sheetForm.mega.move) && (
          <p className="muted" style={{ fontSize: 12 }}>
            {sheetForm.mega.stone && <>{t("pokedex.sheet.megaStone")}: <strong>{itemName(sheetForm.mega.stone)}</strong>{" "}</>}
            {sheetForm.mega.move && <>{t("pokedex.sheet.megaMove")}: <strong>{moveName(sheetForm.mega.move)}</strong></>}
          </p>
        )}
      </Section>

      <Section title={t("pokedex.sheet.moves")} testId="sheet-moves">
        <Tabs<MoveTab>
          tabs={(["level", "tm", "tutor", "egg"] as MoveTab[]).map((id) => ({ id, label: t(`pokedex.sheet.movesTab.${id}`), badge: tabCount[id] }))}
          value={moveTab}
          onChange={setMoveTab}
        />
        <input className={styles.moveFilter} aria-label={t("pokedex.sheet.movesFilter")} placeholder={t("pokedex.sheet.movesFilter")} value={moveFilter} onChange={(e) => setMoveFilter(e.target.value)} />
        {shownMoves.length === 0 ? (
          <p className="muted">{t("pokedex.sheet.noMoves")}</p>
        ) : (
          <ul className={styles.moveList}>
            {shownMoves.map((m, i) => {
              const mv = index?.moves.get(m.id);
              return (
                <li key={`${m.id}-${m.level}-${i}`} className={styles.moveRow}>
                  <span className={styles.moveLv}>{m.level == null ? "" : m.level === 0 ? t("pokedex.sheet.levelEvo") : m.level < 0 ? "—" : m.level}</span>
                  <span className={styles.moveName}>{moveName(m.id)}</span>
                  <TypeChip id={mv?.type} name={mv?.type ? typeName(mv.type) : null} />
                  <CategoryIcon category={mv?.category} />
                  <span className="muted mono" style={{ fontSize: 11, minWidth: 28, textAlign: "right" }}>{mv?.power ? mv.power : ""}</span>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section title={t("pokedex.sheet.encounters")} testId="sheet-encounters">
        {groups.length === 0 ? (
          extrasQ.error ? (
            <p className="muted" data-testid="sheet-extras-error">
              {t("pokedex.sheet.extrasError")}: {errorText(t, extrasQ.error)}{" "}
              <Button size="sm" onClick={() => void extrasQ.refetch()}>{t("pokedex.sheet.retry")}</Button>
            </p>
          ) : (
            <p className="muted">{extras ? t("pokedex.sheet.noEncounters") : t("pokedex.sheet.loading")}</p>
          )
        ) : (
          <ul className={styles.plain}>
            {groups.map((g) => (
              <li key={g.map}>
                <strong>{g.name ?? t("pokedex.sheet.map", { n: g.map })}</strong>
                <ul className={styles.encRows}>
                  {g.rows.map((r, i) => (
                    <li key={`${r.method}-${i}`} className="muted">
                      {pretty("pokedex.enc", r.method)}
                      {levelRange(r.min, r.max) && ` · ${t("pokedex.sheet.levels", { range: levelRange(r.min, r.max) })}`}
                      {r.chance != null && ` · ${r.chance} %`}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {regional.length > 0 && (
        <Section title={t("pokedex.sheet.regional")} testId="sheet-regional">
          <ul className={styles.plain}>
            {regional.map(([dex, n]) => (
              <li key={dex}>
                {t("pokedex.sheet.regionalDex", { n: Number(dex) + 1 })}: <strong className="mono">#{String(n).padStart(3, "0")}</strong>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </aside>
  );
}
