import { Pencil, Trash2 } from "lucide-react";
import { semantic } from "../../api/semantic";
import { speciesFormId } from "../../game/useCatalog";
import { displayName, genderSymbol } from "../../lib/pokemon";
import { useT } from "../../lib/useT";
import { useGame } from "../../stores/game";
import { BallIcon, Button, Chip, HpBar, ItemIcon, PokemonIcon, TypeChip } from "../../ui";
import { QuickActions } from "../pokemon/QuickActions";
import { FlagList } from "../legality/FlagList";
import { LegalityBadge } from "../legality/LegalityBadge";
import { useSemanticQuery } from "../queries";
import styles from "./pc.module.css";

interface Props {
  /** ref del Pokemon seleccionado, o null (casilla vacia / nada seleccionado). */
  pokemonRef: string | null;
  emptySlot: boolean;
  editable: boolean;
  /** La comprobacion de legalidad es parcial (faltan datos del juego). */
  partial?: boolean;
  onEdit: (ref: string) => void;
  onRelease: (ref: string) => void;
}

/** Datos del Pokemon seleccionado, estilo pantalla de resumen: sprite, tipos, nivel, objeto,
 *  naturaleza, habilidad, movimientos e IV/EV; acciones editar y liberar. */
export function InfoPanel({ pokemonRef, emptySlot, editable, partial, onEdit, onRelease }: Props) {
  const { t, dynOr } = useT();
  const catalog = useGame((s) => s.catalogIndex);
  const q = useSemanticQuery(["pokemon", pokemonRef], () => semantic.pokemon(pokemonRef!), !!pokemonRef);

  if (!pokemonRef) {
    return (
      <aside className={styles.info} aria-label={t("pc.info")}>
        <p className="muted">{emptySlot ? t("pc.emptyHint") : t("pc.selectHint")}</p>
        <p className="muted" style={{ fontSize: 12 }}>{t("pc.keyboardHelp")}</p>
      </aside>
    );
  }
  const pk = q.data;
  if (!pk) return <aside className={styles.info} aria-busy="true" />;

  const sp = catalog?.species.get(speciesFormId(pk.species?.id, pk.form));
  const name = pk.egg ? t("party.egg") : displayName(pk);

  return (
    <aside className={styles.info} aria-label={t("pc.info")} data-testid="pc-info">
      <div className={styles.infoHead}>
        <PokemonIcon name={name} species={pk.species?.id ?? 0} form={pk.form} gender={pk.gender} shiny={pk.shiny} egg={pk.egg} size={88} />
        <div style={{ minWidth: 0 }}>
          <div className={styles.infoName}>
            {name} <span className={styles.female}>{genderSymbol(pk.gender)}</span>
          </div>
          {pk.nickname && pk.species && !pk.egg && <div className="muted">{pk.species.name}</div>}
          <div className={styles.infoTypes}>
            {sp?.types.map((ty) => <TypeChip key={ty} id={ty} name={catalog ? undefined : null} />)}
          </div>
          <div className={styles.infoTags}>
            {pk.level != null && <Chip tone="accent">{t("party.level", { level: pk.level })}</Chip>}
            {pk.shiny && <Chip tone="warn">★ {t("party.shiny")}</Chip>}
          </div>
        </div>
      </div>

      <div className={styles.infoBar}>
        <span className="muted" style={{ fontSize: 12 }}>{t("party.hp")} {pk.hp ?? "?"}/{pk.totalHp ?? "?"}</span>
        <HpBar hp={pk.hp} total={pk.totalHp} />
      </div>

      <dl className={styles.infoGrid}>
        <dt>{t("pokemon.item")}</dt>
        <dd>
          {pk.item ? <><ItemIcon item={{ id: pk.item.id }} size={20} /> {pk.item.name}</> : t("party.noItem")}
        </dd>
        <dt>{t("pokemon.nature")}</dt>
        <dd>{pk.nature ? dynOr("nature", pk.nature.id, pk.nature.name) : "—"}</dd>
        <dt>{t("pokemon.ability")}</dt>
        <dd>{pk.ability?.name ?? "—"}</dd>
        {pk.ball != null && (
          <>
            <dt>{t("pc.ball")}</dt>
            <dd><BallIcon ball={pk.ball} size={18} /> {String(pk.ball)}</dd>
          </>
        )}
      </dl>

      <div className={styles.sectionLabel}>{t("pokemon.tabs.moves")}</div>
      <ul className={styles.moves}>
        {pk.moves.map((m) => {
          const mv = m.id != null ? catalog?.moves.get(String(m.id)) : undefined;
          return (
            <li key={m.slot}>
              <span>{m.name ?? m.id}</span>
              {mv?.type && <TypeChip id={mv.type} />}
              {m.pp != null && <span className="muted mono" style={{ fontSize: 11 }}>{m.pp}</span>}
            </li>
          );
        })}
      </ul>

      <div className={styles.sectionLabel}>{t("legality.title")}</div>
      <LegalityBadge flags={pk.flags} partial={partial} />
      {pk.flags.some((f) => f.severity !== "info") && <FlagList flags={pk.flags.filter((f) => f.severity !== "info")} limit={3} />}

      <QuickActions pk={pk} editable={editable} />

      <div className={styles.actions}>
        <Button variant="primary" size="sm" onClick={() => onEdit(pk.ref)}>
          <Pencil size={14} /> {t("pc.edit")}
        </Button>
        <Button size="sm" variant="ghost" disabled={!editable} onClick={() => onRelease(pk.ref)}>
          <Trash2 size={14} /> {t("pc.release")}
        </Button>
      </div>
    </aside>
  );
}
