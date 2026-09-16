import { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useEditorStore } from "../store";
import { confidenceClass, typeColorClass } from "../typeColors";

const TYPE_PRESETS = [
  { label: "Todos", value: "" },
  { label: "nil (todos)", value: "nil" },
  { label: "nil sin tipo inferido", value: "nil:?" },
  { label: "int", value: "int" },
  { label: "float", value: "float" },
  { label: "str", value: "str" },
  { label: "sym", value: "sym" },
  { label: "bool", value: "bool" },
  { label: "objetos", value: "obj" },
];

export function FieldBrowser() {
  const filterPath = useEditorStore((s) => s.filterPath);
  const filterType = useEditorStore((s) => s.filterType);
  const setFilterPath = useEditorStore((s) => s.setFilterPath);
  const setFilterType = useEditorStore((s) => s.setFilterType);
  const setPage = useEditorStore((s) => s.setPage);
  const listResult = useEditorStore((s) => s.listResult);
  const loadingList = useEditorStore((s) => s.loadingList);
  const selectField = useEditorStore((s) => s.selectField);
  const selectedIndex = useEditorStore((s) => s.selectedIndex);

  const parentRef = useRef<HTMLDivElement>(null);
  const rows = listResult?.fields ?? [];

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 30,
    overscan: 12,
  });

  const isPreset = TYPE_PRESETS.some((p) => p.value === filterType);

  return (
    <div className="field-browser">
      <div className="filter-bar">
        <input
          className="filter-path"
          placeholder="Filtrar por ruta (ej. @item, Pokemon)..."
          value={filterPath}
          onChange={(e) => setFilterPath(e.target.value)}
        />
        <select
          value={isPreset ? filterType : "__custom"}
          onChange={(e) => {
            if (e.target.value !== "__custom") setFilterType(e.target.value);
          }}
        >
          {TYPE_PRESETS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
          <option value="__custom">Personalizado...</option>
        </select>
        <input
          className="filter-type"
          placeholder="tipo exacto (nil:str, obj:Pokemon...)"
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
        />
      </div>

      {listResult && (
        <div className="list-meta dim">
          {listResult.total.toLocaleString()} campo(s) · página {listResult.page + 1} de{" "}
          {Math.max(listResult.totalPages, 1)} · {listResult.pendingCount} cambio(s) pendiente(s)
        </div>
      )}

      <div className="field-table-scroll" ref={parentRef}>
        {loadingList && <div className="loading-overlay">Cargando…</div>}
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((vRow) => {
            const field = rows[vRow.index];
            return (
              <div
                key={field.index}
                className={"field-row" + (field.index === selectedIndex ? " selected" : "")}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: vRow.size,
                  transform: `translateY(${vRow.start}px)`,
                }}
                onClick={() => selectField(field.index)}
              >
                <span className="field-path">{field.path}</span>
                {field.nil ? (
                  field.inferred ? (
                    <span className={"tag " + confidenceClass(field.inferred.confidence)}>
                      [nil&gt;{field.inferred.type.replace("obj:", "")}]
                    </span>
                  ) : (
                    <span className="tag t-nil">[nil&gt;?]</span>
                  )
                ) : (
                  <span className={"field-value " + typeColorClass(field.value?.kind ?? field.type)}>
                    {field.value?.display}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {listResult && listResult.totalPages > 1 && (
        <div className="pagination">
          <button disabled={listResult.page === 0} onClick={() => setPage(listResult.page - 1)}>
            ← Anterior
          </button>
          <span>
            Página {listResult.page + 1} / {listResult.totalPages}
          </span>
          <button
            disabled={listResult.page + 1 >= listResult.totalPages}
            onClick={() => setPage(listResult.page + 1)}
          >
            Siguiente →
          </button>
        </div>
      )}
    </div>
  );
}
