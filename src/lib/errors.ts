import type { TFunction } from "i18next";
import type { ApiError, Issue } from "../api/types";

/** `t` con clave dinamica (las claves de error/issue se construyen en tiempo de ejecucion). */
function tr(t: TFunction, key: string, opts?: Record<string, unknown>): string {
  return t(key as never, (opts ?? {}) as never) as unknown as string;
}

/** Texto traducido de un error del backend/driver. */
export function errorText(t: TFunction, err: ApiError): string {
  const p = (err.params ?? {}) as Record<string, unknown>;
  const dict = (key: string, extra: Record<string, unknown> = {}) =>
    tr(t, `errors.${key}`, { message: err.message, ...p, ...extra });

  // Los errores de validacion llevan un `code` mas especifico en params.
  if (typeof p.code === "string" && p.code === "type_mismatch") return dict("type_mismatch");
  const known = [
    "FileNotFound", "FormatError", "NoSessionOpen", "ReadOnlyProfile", "ValidationError", "FieldMissing",
    "UnknownRef", "PokemonNotFound", "RoleNotFound", "NoMoveTemplate", "NotEditable", "UnknownOp",
    "SaveError", "EncodingError", "RubyMissing", "DriverMissing", "SpawnFailed", "Fatal", "InternalError",
    "GameFolderInvalid", "NotAGameFolder", "PendingChanges", "GameFolderRequired", "SpeciesNotFound", "NoGameFolder",
    "InvalidPath", "FileTooLarge", "AssetMapCorrupt", "Io", "AssetScope", "AppDataDir", "Internal", "PartyFull", "PartyTooSmall",
  ];
  if (known.includes(err.kind)) return dict(err.kind);
  return dict("default");
}

/** Texto traducido de un issue de validacion. */
export function issueText(t: TFunction, issue: Issue): string {
  const p = issue.params as Record<string, unknown>;
  if (issue.code === "value_range") {
    const fieldKey = String(p.field ?? "");
    const label = fieldLabel(t, fieldKey);
    const key = p.max == null ? "issues.value_range_nomax" : "issues.value_range";
    return tr(t, key, { ...p, field: label });
  }
  if (issue.code === "moves_duplicate") {
    const moves = Array.isArray(p.moves) ? (p.moves as unknown[]).join(", ") : String(p.moves ?? "");
    return t("issues.moves_duplicate", { moves });
  }
  return tr(t, `issues.${issue.code}`, p);
}

function fieldLabel(t: TFunction, field: string): string {
  const [head, stat] = field.split(".");
  if ((head === "iv" || head === "ev") && stat) {
    return `${head.toUpperCase()} ${tr(t, `stat.${stat}`)}`;
  }
  const known = ["money", "coins", "battle_points", "soot", "level", "happiness"];
  return known.includes(field) ? tr(t, `issues.field.${field}`) : field;
}
