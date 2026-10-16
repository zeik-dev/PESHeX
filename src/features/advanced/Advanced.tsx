import { useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Wrench, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { advanced, type GetFieldResult, type SetFieldResult } from "../../api/advanced";
import { toApiError } from "../../api/tauri";
import { errorText } from "../../lib/errors";
import { useT } from "../../lib/useT";
import { useEdit } from "../../stores/edit";
import { useSession } from "../../stores/session";
import { Banner, Button, Card, Chip, PageTitle, PokeballSpinner, Tabs } from "../../ui";
import { useSemanticQuery } from "../queries";
import styles from "./advanced.module.css";

type Tab = "fields" | "nil";

const TYPE_PRESETS = ["", "nil", "nil:?", "int", "float", "str", "sym", "bool", "obj"] as const;

function kindClass(kind: string | undefined): string {
  if (!kind || kind === "nil") return styles.k_nil;
  if (kind === "int" || kind === "float" || kind === "bool") return styles.k_num;
  if (kind === "str") return styles.k_str;
  if (kind === "sym") return styles.k_sym;
  return styles.k_obj;
}

function confClass(c: string | null | undefined): string {
  return c === "alta" ? styles.c_alta : c === "media" ? styles.c_media : c === "baja" ? styles.c_baja : styles.k_nil;
}

/** Vista Avanzado: todos los campos crudos del save. El indice (Collector) se
 *  construye al entrar, no al abrir el archivo. */
export function Advanced() {
  const { t } = useT();
  const filePath = useSession((s) => s.filePath);
  // Si el save se recarga del disco, el indice de campos se reconstruye (no se usa `revision`: sube con cada edicion).
  const reloads = useSession((s) => s.reloads);
  const [tab, setTab] = useState<Tab>("fields");
  const index = useQuery({ queryKey: ["index", filePath, reloads], queryFn: advanced.buildIndex, enabled: !!filePath, staleTime: Infinity });

  return (
    <div>
      <PageTitle icon={<Wrench />} title={t("advanced.title")} subtitle={t("advanced.subtitle")} />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "fields", label: t("advanced.tabs.fields"), badge: index.data?.fieldCount?.toLocaleString() },
          { id: "nil", label: t("advanced.tabs.nil"), badge: index.data?.nilCount?.toLocaleString() },
        ]}
      />
      {index.isPending && <PokeballSpinner label={t("advanced.buildingIndex")} />}
      {index.isError && <Banner tone="bad" title={t("errors.title")}>{errorText(t, toApiError(index.error))}</Banner>}
      {index.data && (tab === "fields" ? <FieldsTab /> : <NilTab />)}
    </div>
  );
}

function FieldsTab() {
  const { t } = useT();
  const initial = useSession((s) => s.advancedFilter);
  const setCounts = useSession((s) => s.setCounts);
  const [filterPath, setFilterPath] = useState(initial);
  const [filterType, setFilterType] = useState("");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);

  useEffect(() => {
    setFilterPath(initial);
    setPage(0);
  }, [initial]);

  const q = useSemanticQuery(["fields", filterPath, filterType, page], () => advanced.listFields(filterPath, filterType || null, page));
  useEffect(() => {
    if (q.data) setCounts(q.data.pendingCount);
  }, [q.data, setCounts]);

  const rows = q.data?.fields ?? [];
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({ count: rows.length, getScrollElement: () => parentRef.current, estimateSize: () => 30, overscan: 12 });
  const isPreset = (TYPE_PRESETS as readonly string[]).includes(filterType);

  const presetLabel = (v: string) =>
    v === "" ? t("advanced.anyType") : v === "nil" ? "nil" : v === "nil:?" ? "nil (?)" : v === "obj" ? "obj" : v;

  return (
    <div className={styles.layout}>
      <div>
        <div className={styles.filters}>
          <input
            className="input"
            style={{ minHeight: 36, padding: "0 12px", border: "1px solid var(--border)", borderRadius: 8, background: "var(--surface)", color: "var(--text)" }}
            placeholder={t("advanced.filterPath")}
            value={filterPath}
            onChange={(e) => { setFilterPath(e.target.value); setPage(0); }}
            aria-label={t("advanced.filterPath")}
          />
          <select
            style={{ minHeight: 36, padding: "0 10px", border: "1px solid var(--border)", borderRadius: 8, background: "var(--surface)", color: "var(--text)" }}
            value={isPreset ? filterType : ""}
            aria-label={t("advanced.filterType")}
            onChange={(e) => { setFilterType(e.target.value); setPage(0); }}
          >
            {TYPE_PRESETS.map((v) => (
              <option key={v} value={v}>{presetLabel(v)}</option>
            ))}
          </select>
        </div>
        {q.data && (
          <div className={styles.meta}>
            {t("advanced.fieldCount", { count: q.data.total })}
            {q.data.totalPages > 1 && ` · ${t("advanced.page", { page: q.data.page + 1, pages: q.data.totalPages })}`}
          </div>
        )}
        <div className={styles.scroll} ref={parentRef}>
          {q.isPending && <PokeballSpinner size={28} />}
          {q.data && rows.length === 0 && <div style={{ padding: 20 }} className="muted">{t("advanced.noResults")}</div>}
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualizer.getVirtualItems().map((v) => {
              const f = rows[v.index];
              return (
                <div
                  key={f.index}
                  className={styles.row + (f.index === selected ? " " + styles.selected : "")}
                  style={{ position: "absolute", top: 0, left: 0, width: "100%", height: v.size, transform: `translateY(${v.start}px)` }}
                  onClick={() => setSelected(f.index)}
                >
                  <span className={styles.path} title={f.path}>{f.path}</span>
                  {f.nil ? (
                    <span className={styles.value + " " + confClass(f.inferred?.confidence)}>
                      [nil&gt;{f.inferred ? f.inferred.type.replace("obj:", "") : "?"}]
                    </span>
                  ) : (
                    <span className={styles.value + " " + kindClass(f.value?.kind ?? f.type)}>{f.value?.display}</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        {q.data && q.data.totalPages > 1 && (
          <div className={styles.pagination}>
            <Button size="sm" disabled={q.data.page === 0} onClick={() => setPage(q.data!.page - 1)}>← {t("common.previous")}</Button>
            <Button size="sm" disabled={q.data.page + 1 >= q.data.totalPages} onClick={() => setPage(q.data!.page + 1)}>{t("common.next")} →</Button>
          </div>
        )}
      </div>

      <div className={styles.detail}>
        {selected == null ? (
          <Card><span className="muted">{t("advanced.selectField")}</span></Card>
        ) : (
          <FieldDetail key={selected} index={selected} onClose={() => setSelected(null)} />
        )}
      </div>
    </div>
  );
}

function FieldDetail({ index, onClose }: { index: number; onClose: () => void }) {
  const { t } = useT();
  const setCounts = useSession((s) => s.setCounts);
  const [detail, setDetail] = useState<GetFieldResult | null>(null);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ message: string; input: string } | null>(null);
  const [templates, setTemplates] = useState<{ cls: string; instances: NonNullable<SetFieldResult["instances"]> } | null>(null);

  async function load() {
    try {
      setDetail(await advanced.getField(index));
    } catch (e) {
      setError(errorText(t, toApiError(e)));
    }
  }
  useEffect(() => {
    void load();
    // Se recarga solo al cambiar el campo seleccionado.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  async function submit(raw: string, confirmed: boolean) {
    if (!raw.trim()) return;
    setError(null);
    try {
      const r = await advanced.setField(index, raw, confirmed);
      if (r.rejected) return useEdit.getState().reject(r.rejected.flags);
      if (r.needsConfirmation) return setConfirm({ message: r.message ?? "?", input: raw });
      if (r.needsTemplateChoice) return setTemplates({ cls: r.class ?? "", instances: r.instances ?? [] });
      setConfirm(null);
      setTemplates(null);
      if (r.applied) {
        setInput("");
        if (typeof r.pendingCount === "number") setCounts(r.pendingCount, 0);
        if (r.structuralRebuild) onClose(); // los indices de campo ya no son validos
        else await load();
      }
    } catch (e) {
      setError(errorText(t, toApiError(e)));
    }
  }

  if (!detail) return <Card>{error ? <span style={{ color: "var(--danger)" }}>{error}</span> : <PokeballSpinner size={28} />}</Card>;
  const inf = detail.nil ? detail.nilInference : undefined;

  return (
    <Card
      title={t("advanced.currentValue")}
      actions={<Button size="sm" variant="ghost" icon onClick={onClose} aria-label={t("advanced.closeDetail")}><X size={16} /></Button>}
    >
      <div className={styles.detailPath}>{detail.path}</div>
      <div className="muted" style={{ fontSize: 12 }}>{t("advanced.slot")}: {detail.slotKeys.join(" | ")}</div>
      <div className={styles.box}>
        {detail.nil ? <Chip>nil</Chip> : <span className={kindClass(detail.value?.kind ?? detail.type)}>{detail.value?.display}</span>}
      </div>

      {inf && (
        <div className={styles.box}>
          <strong>{t("advanced.inference")}</strong>
          {inf.candidates.length === 0 && <div className="muted">—</div>}
          {inf.candidates.slice(0, 3).map((c) => (
            <div key={c.type}>
              <span className={confClass(inf.confidence)}>{c.type} ({c.scorePct}%)</span>
              <ul className={styles.evidence}>{c.evidence.slice(0, 3).map((l, j) => <li key={j}>{l}</li>)}</ul>
            </div>
          ))}
        </div>
      )}

      {detail.templates.length > 0 && (
        <div className="muted" style={{ fontSize: 12 }}>
          {t("advanced.templates")}: {detail.templates.map((x) => `${x.class} (${x.count}${x.truncated ? "+" : ""})`).join(", ")}
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>{t("advanced.newValueHint")}</div>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            style={{ flex: 1, minHeight: 36, padding: "0 12px", border: "1px solid var(--border)", borderRadius: 8, background: "var(--surface)", color: "var(--text)" }}
            value={input}
            aria-label={t("advanced.newValue")}
            placeholder="int:5 · str:hola · sym:POTION · nil"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void submit(input, false)}
          />
          <Button variant="primary" onClick={() => void submit(input, false)}>{t("advanced.apply")}</Button>
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
          {["nil", "[]", "{}"].map((v) => <Button key={v} size="sm" onClick={() => void submit(v, false)}>{v}</Button>)}
          <Button size="sm" onClick={() => void submit("copiar", false)}>{t("advanced.template")}…</Button>
        </div>
      </div>

      {error && <p style={{ color: "var(--danger)" }} role="alert">{error}</p>}
      {confirm && (
        <Banner tone="warn" title={t("advanced.confirmTypeChange")}>
          {confirm.message}
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <Button size="sm" variant="primary" onClick={() => void submit(confirm.input, true)}>{t("common.confirm")}</Button>
            <Button size="sm" onClick={() => setConfirm(null)}>{t("common.cancel")}</Button>
          </div>
        </Banner>
      )}
      {templates && (
        <div className={styles.box}>
          <strong>{templates.cls}</strong>
          <ul className={styles.evidence}>
            {templates.instances.map((inst) => (
              <li key={inst.slot}>
                <button type="button" style={{ background: "none", border: 0, color: "var(--accent)", cursor: "pointer", padding: 0 }}
                  onClick={() => void submit(`copiar ${templates.cls} ${inst.slot + 1}`, false)}>
                  {inst.path}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

function NilTab() {
  const { t } = useT();
  const q = useSemanticQuery("nilreport", advanced.nilReport);
  if (!q.data) return <PokeballSpinner />;
  const r = q.data;
  return (
    <Card title={t("advanced.nilTitle")}>
      <div className={styles.summary}>
        <Chip tone="good">{t("advanced.nilSummary", r.summary)}</Chip>
      </div>
      <table className={styles.nilTable}>
        <thead>
          <tr>
            <th>{t("advanced.slot")}</th>
            <th>{t("unclassified.colLeaves")}</th>
            <th>{t("advanced.inferred")}</th>
            <th>{t("advanced.confidence")}</th>
            <th>{t("advanced.evidence")}</th>
          </tr>
        </thead>
        <tbody>
          {r.groups.map((g) => (
            <tr key={g.slotKey}>
              <td className={styles.slotKey}>{g.slotKey}</td>
              <td>{g.count}</td>
              <td>{g.inferredType ?? "?"}</td>
              <td className={confClass(g.confidence)}>{g.confidence ?? "-"}</td>
              <td className="muted">{g.topEvidence ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
