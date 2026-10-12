// Vista Avanzado: campos crudos del save (indice Collector del driver).

import { driverCall } from "./tauri";
import type { ValueSummary } from "./types";

export interface IndexStatus {
  state: "idle" | "ready";
  fieldCount: number | null;
  nilCount: number | null;
}

export interface FieldRow {
  index: number;
  path: string;
  type: string;
  nil: boolean;
  value?: ValueSummary;
  inferred?: { type: string; confidence: string };
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

export interface GetFieldResult {
  index: number;
  path: string;
  slotKeys: string[];
  type: string;
  nil: boolean;
  value?: ValueSummary & { truncated?: boolean; fullLength?: number };
  nilInference?: { confidence: string | null; candidates: Candidate[] };
  templates: { class: string; count: number; truncated: boolean }[];
}

export interface SetFieldResult {
  applied: boolean;
  reason?: string;
  needsConfirmation?: boolean;
  needsTemplateChoice?: boolean;
  message?: string;
  class?: string;
  instances?: { slot: number; path: string }[];
  old?: ValueSummary;
  new?: ValueSummary;
  pendingCount?: number;
  structuralRebuild?: boolean;
  /** HeX: la edicion introduciria ilegalidades y no se aplico. */
  rejected?: { code: string; mode: string; flags: import("./types").Flag[] };
  newFlags?: import("./types").Flag[];
}

export interface NilReportGroup {
  slotKey: string;
  count: number;
  inferredType: string | null;
  confidence: string | null;
  topEvidence: string | null;
}

export interface NilReport {
  groups: NilReportGroup[];
  summary: { alta: number; media: number; baja: number; sin: number };
}

export const advanced = {
  indexStatus: () => driverCall<IndexStatus>("index_status"),
  buildIndex: () => driverCall<IndexStatus>("build_index"),
  listFields: (filterPath: string, filterType: string | null, page: number) =>
    driverCall<ListFieldsResult>("list_fields", { filterPath, filterType, page }),
  getField: (index: number) => driverCall<GetFieldResult>("get_field", { index }),
  setField: (index: number, input: string, confirmed = false) =>
    driverCall<SetFieldResult>("set_field", { index, input, confirmed }),
  nilReport: () => driverCall<NilReport>("nil_report"),
  locate: (path: string) => driverCall<{ found: boolean; index: number | null; path: string }>("locate_field", { path }),
};
