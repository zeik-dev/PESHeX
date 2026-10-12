import { useMemo } from "react";
import { useGame } from "../stores/game";
import { ItemIcon, PokemonIcon } from "../ui/GameImage";
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
        icon: withIcons ? <PokemonIcon name={name} species={s.species} form={s.form} size={28} /> : undefined,
      };
    });
  }, [catalog, withIcons]);
}

export function useMoveOptions(): ComboOption[] | null {
  const catalog = useGame((s) => s.catalog);
  return useMemo(
    () => catalog?.moves.map((m) => ({ id: m.id, label: m.name ?? prettyId(m.id), sub: m.type ?? m.id })) ?? null,
    [catalog],
  );
}

/** `pocket` filtra por bolsillo del motor (1-8); sin el, todos los objetos. */
export function useItemOptions(pocket?: number | null): ComboOption[] | null {
  const catalog = useGame((s) => s.catalog);
  return useMemo(() => {
    if (!catalog) return null;
    const list = pocket ? catalog.items.filter((i) => i.pocket === pocket) : catalog.items;
    return list.map((i) => ({
      id: i.id,
      label: i.name ?? prettyId(i.id),
      sub: i.id,
      icon: <ItemIcon item={{ id: i.id }} size={24} />,
    }));
  }, [catalog, pocket]);
}

/** `allowed` pone primero las habilidades de la especie. */
export function useAbilityOptions(allowed?: string[]): ComboOption[] | null {
  const catalog = useGame((s) => s.catalog);
  return useMemo(() => {
    if (!catalog) return null;
    const rank = new Map((allowed ?? []).map((a, i) => [a, i]));
    const all = catalog.abilities.map((a) => ({
      id: a.id,
      label: a.name ?? prettyId(a.id),
      sub: a.id,
      order: rank.get(a.id) ?? 9999,
    }));
    all.sort((x, y) => x.order - y.order);
    return all.map(({ order: _o, ...o }) => o);
  }, [catalog, allowed]);
}
