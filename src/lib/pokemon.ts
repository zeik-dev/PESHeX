import type { PokemonSummary } from "../api/types";

export function displayName(p: Pick<PokemonSummary, "nickname" | "species">): string {
  return p.nickname || p.species?.name || "???";
}

export function genderSymbol(g: number | null | undefined): string {
  return g === 0 ? "♂" : g === 1 ? "♀" : "";
}

export const NATURE_IDS = [
  "HARDY", "LONELY", "BRAVE", "ADAMANT", "NAUGHTY", "BOLD", "DOCILE", "RELAXED", "IMPISH", "LAX",
  "TIMID", "HASTY", "SERIOUS", "JOLLY", "NAIVE", "MODEST", "MILD", "QUIET", "BASHFUL", "RASH",
  "CALM", "GENTLE", "SASSY", "CAREFUL", "QUIRKY",
] as const;

export const STATUS_IDS = ["NONE", "SLEEP", "POISON", "BURN", "PARALYSIS", "FROZEN"] as const;
