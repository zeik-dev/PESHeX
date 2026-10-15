import { useMemo } from "react";
import { useT } from "../lib/useT";
import { useGame } from "../stores/game";
import { CategoryIcon } from "../ui/CategoryIcon";
import { BallIcon, ItemIcon, PokemonIcon } from "../ui/GameImage";
import { TypeIcon } from "../ui/TypeIcon";
import { itemDisplayName } from "./lookup";
import type { ComboOption } from "../ui/combobox";

export function prettyId(id: string): string {
  return id
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/(^|\s)\S/g, (c) => c.toUpperCase());
}

/** Id compuesto de especie+forma tal como lo usan los selectores ("SHELLOS_1"). */
export function speciesFormId(species: string | number | null | undefined, form: number | null | undefined): string {
  if (species == null) return "";
  return form && form > 0 ? `${species}_${form}` : String(species);
}

/** Opciones de especie (con su icono si el juego lo tiene), o null sin catalogo. */
export function useSpeciesOptions(withIcons = true): ComboOption[] | null {
  const catalog = useGame((s) => s.catalog);
  return useMemo(() => {
    if (!catalog) return null;
    return catalog.species.map((s) => {
      const name = s.name ?? prettyId(s.species);
      return {
        id: s.id,
        label: s.formName && s.form > 0 ? `${name} (${s.formName})` : name,
        sub: s.id,
        icon: withIcons ? <PokemonIcon name={name} species={s.species} form={s.form} number={s.number} size={28} /> : undefined,
      };
    });
  }, [catalog, withIcons]);
}

/** `allowed` (ids internos) limita la lista a los movimientos que la especie puede aprender. */
export function useMoveOptions(allowed?: ReadonlySet<string> | null): ComboOption[] | null {
  const catalog = useGame((s) => s.catalog);
  const { t } = useT();
  return useMemo(() => {
    if (!catalog) return null;
    const list = allowed ? catalog.moves.filter((m) => allowed.has(m.id)) : catalog.moves;
    return list.map((m) => {
      const stats = [m.power ? t("pokemon.moves.power", { n: m.power }) : null, m.pp ? t("pokemon.moves.ppShort", { n: m.pp }) : null].filter(Boolean).join(" · ");
      return {
        id: m.id,
        label: m.name ?? prettyId(m.id),
        // El tipo va a la izquierda (también dentro del campo cerrado); la categoría, la potencia y los PP, a la derecha.
        icon: <TypeIcon type={m.type} />,
        right: (
          <>
            <CategoryIcon category={m.category} />
            {stats && <span className="mono">{stats}</span>}
          </>
        ),
        search: [m.type, m.power, m.id].filter(Boolean).join(" "),
      };
    });
  }, [catalog, allowed, t]);
}

/** `pocket` filtra por bolsillo del motor (1-8); sin el, todos los objetos. Busca por nombre, id interno y numero
 *  (bases <= v18); las MT/MO se nombran con su movimiento («MT01 · Ventisca»). */
export function useItemOptions(pocket?: number | null): ComboOption[] | null {
  const catalog = useGame((s) => s.catalog);
  const index = useGame((s) => s.catalogIndex);
  return useMemo(() => {
    if (!catalog) return null;
    const list = pocket ? catalog.items.filter((i) => i.pocket === pocket) : catalog.items;
    return list.map((i) => ({
      id: i.id,
      label: itemDisplayName(i, index, prettyId(i.id)),
      sub: i.number != null ? `${i.id} · #${i.number}` : i.id,
      icon: <ItemIcon item={{ id: i.id }} size={24} />,
    }));
  }, [catalog, index, pocket]);
}

/** Poké Balls (bolsillo 3) con el icono de bola del juego (o el del objeto si no lo trae). */
export function useBallOptions(): ComboOption[] | null {
  const catalog = useGame((s) => s.catalog);
  const index = useGame((s) => s.catalogIndex);
  return useMemo(() => {
    if (!catalog) return null;
    return catalog.items
      .filter((i) => i.pocket === 3)
      .map((i) => ({
        id: i.id,
        label: itemDisplayName(i, index, prettyId(i.id)),
        sub: i.number != null ? `${i.id} · #${i.number}` : i.id,
        icon: <BallIcon ball={i.id} size={24} />,
      }));
  }, [catalog, index]);
}

/** `allowed` pone primero las habilidades de la especie; con `onlyAllowed` la lista se limita a ellas; `hidden` marca
 *  las habilidades ocultas. */
export function useAbilityOptions(allowed?: string[], onlyAllowed = false, hidden?: string[]): ComboOption[] | null {
  const catalog = useGame((s) => s.catalog);
  const { t } = useT();
  return useMemo(() => {
    if (!catalog) return null;
    const rank = new Map((allowed ?? []).map((a, i) => [a, i]));
    const pool = onlyAllowed && allowed?.length ? catalog.abilities.filter((a) => rank.has(a.id)) : catalog.abilities;
    const all = pool.map((a) => ({
      id: a.id,
      label: a.name ?? prettyId(a.id),
      sub: hidden?.includes(a.id) ? `${a.id} · ${t("pokemon.abilityHidden")}` : a.id,
      order: rank.get(a.id) ?? 9999,
    }));
    all.sort((x, y) => x.order - y.order);
    return all.map(({ order: _o, ...o }) => o);
  }, [catalog, allowed, onlyAllowed, hidden, t]);
}
