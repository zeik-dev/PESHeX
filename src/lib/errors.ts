import type { TFunction } from "i18next";
import type { ApiError } from "../api/types";

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
    "RecalcUnavailable", "PcFull", "SlotOccupied", "BackupNotFound", "NoPokemonTemplate",
    "InvalidPath", "FileTooLarge", "AssetMapCorrupt", "Io", "AssetScope", "AppDataDir", "Internal", "PartyFull", "PartyTooSmall",
  ];
  if (known.includes(err.kind)) return dict(err.kind);
  return dict("default");
}
