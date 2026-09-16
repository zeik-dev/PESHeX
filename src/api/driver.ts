// Wrapper tipado sobre los comandos de Tauri (src-tauri/src/commands.rs), que
// a su vez hablan el protocolo JSON de driver/rxdata_driver.rb. Los tipos de
// aca son un espejo exacto de las respuestas del driver (ver §2 del plan) -
// el editor de valores en la UI nunca reimplementa la gramatica de
// UI.parse_as en TypeScript, siempre manda el string crudo del usuario tal
// cual y muestra el mensaje de error que devuelva el driver.

import { invoke } from "@tauri-apps/api/core";

export interface ScriptReport {
  filesScanned: number;
  hints: number;
  fallbackFiles: number;
  rootsUsed: string[];
  errors: string[];
}

export interface CheckResult {
  roots: number;
  wrapper: string;
  roundtripClean: boolean;
  diffByte: number | null;
}

export interface OpenResult {
  roots: number;
  wrapper: string;
  roundtripClean: boolean;
  diffByte: number | null;
  fieldCount: number;
  nilCount: number;
  scripts: ScriptReport;
}

export interface ValueSummary {
  kind: string;
  display: string;
  value?: string | number | boolean | null;
  truncated?: boolean;
  fullLength?: number;
  count?: number;
  special?: string;
}

export interface InferredSummary {
  type: string;
  confidence: string;
}

export interface FieldRow {
  index: number;
  path: string;
  type: string;
  nil: boolean;
  value?: ValueSummary;
  inferred?: InferredSummary;
}

export interface ListFieldsResult {
  total: number;
  totalPages: number;
  page: number;
  pageSize: number;
  pendingCount: number;
  fields: FieldRow[];
}

export interface Candidate {
  type: string;
  scorePct: number;
  evidence: string[];
}

export interface NilInference {
  confidence: string | null;
  candidates: Candidate[];
}

export interface TemplateInfo {
  class: string;
  count: number;
  truncated: boolean;
}

export interface GetFieldResult {
  index: number;
  path: string;
  slotKeys: string[];
  type: string;
  nil: boolean;
  value?: ValueSummary;
  nilInference?: NilInference;
  templates: TemplateInfo[];
}

export interface TemplateInstance {
  slot: number;
  path: string;
}

export interface ListTemplatesResult {
  class: string;
  instances: TemplateInstance[];
}

export interface SetFieldResult {
  applied: boolean;
  reason?: string;
  needsConfirmation?: boolean;
  needsTemplateChoice?: boolean;
  message?: string;
  inferredType?: string;
  proposedType?: string;
  currentType?: string;
  class?: string;
  instances?: TemplateInstance[];
  old?: ValueSummary;
  new?: ValueSummary;
  pendingCount?: number;
  structuralRebuild?: boolean;
  newFieldCount?: number;
}

export interface ChangeEntry {
  path: string;
  old: ValueSummary;
  new: ValueSummary;
}

export interface ListChangesResult {
  count: number;
  changes: ChangeEntry[];
}

export interface NilReportGroup {
  slotKey: string;
  count: number;
  inferredType: string | null;
  confidence: string | null;
  topEvidence: string | null;
}

export interface NilReportSummary {
  alta: number;
  media: number;
  baja: number;
  sin: number;
}

export interface NilReportResult {
  groups: NilReportGroup[];
  summary: NilReportSummary;
}

export interface SaveResult {
  applied: boolean;
  reason?: string;
  needsConfirmation?: boolean;
  message?: string;
  bytesWritten?: number;
  backupPath?: string;
  changesApplied?: number;
}

export const driver = {
  checkFile: (path: string) => invoke<CheckResult>("check_file", { path }),

  openSave: (path: string, scripts: string[] = [], autodetect = true, pageSize = 100) =>
    invoke<OpenResult>("open_save", { path, scripts, autodetect, pageSize }),

  closeSave: () => invoke<void>("close_save"),

  listFields: (filterPath: string, filterType: string | null, page: number) =>
    invoke<ListFieldsResult>("list_fields", { filterPath, filterType, page }),

  getField: (index: number) => invoke<GetFieldResult>("get_field", { index }),

  listTemplates: (className: string) => invoke<ListTemplatesResult>("list_templates", { className }),

  setField: (index: number, input: string, confirmed = false) =>
    invoke<SetFieldResult>("set_field", { index, input, confirmed }),

  listChanges: () => invoke<ListChangesResult>("list_changes"),

  nilReport: () => invoke<NilReportResult>("nil_report"),

  save: (backup = true, confirmed = false) => invoke<SaveResult>("save", { backup, confirmed }),
};

/** Los comandos de Tauri rechazan la promesa con el String de error tal cual. */
export function errorMessage(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return String(e);
}
