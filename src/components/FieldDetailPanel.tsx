import { useEffect, useState } from "react";
import { driver, errorMessage, type GetFieldResult, type TemplateInstance } from "../api/driver";
import { useEditorStore } from "../store";
import { confidenceClass, typeColorClass } from "../typeColors";

interface Props {
  index: number;
}

interface PendingConfirm {
  message: string;
  retryInput: string;
}

interface TemplateChoice {
  className: string;
  instances: TemplateInstance[];
}

export function FieldDetailPanel({ index }: Props) {
  const refreshList = useEditorStore((s) => s.refreshList);
  const onStructuralRebuild = useEditorStore((s) => s.onStructuralRebuild);
  const selectField = useEditorStore((s) => s.selectField);

  const [detail, setDetail] = useState<GetFieldResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [inputValue, setInputValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const [templateChoice, setTemplateChoice] = useState<TemplateChoice | null>(null);

  async function loadDetail() {
    setLoading(true);
    try {
      const result = await driver.getField(index);
      setDetail(result);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadDetail();
    setInputValue("");
    setPendingConfirm(null);
    setTemplateChoice(null);
    setError(null);
    // Se recarga a proposito solo cuando cambia `index` (key del componente
    // en el padre): loadDetail no debe repetirse por sus propias renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  async function submit(rawInput: string, confirmed: boolean) {
    if (!rawInput.trim()) return;
    setError(null);
    try {
      const result = await driver.setField(index, rawInput, confirmed);

      if (result.needsConfirmation) {
        setPendingConfirm({ message: result.message ?? "¿Confirmar?", retryInput: rawInput });
        return;
      }
      if (result.needsTemplateChoice) {
        setTemplateChoice({ className: result.class ?? "", instances: result.instances ?? [] });
        return;
      }

      setPendingConfirm(null);
      setTemplateChoice(null);

      if (result.applied) {
        setInputValue("");
        if (result.structuralRebuild) {
          // El indice de este campo (y de cualquier otro) ya no es valido:
          // el store cierra este panel y refresca la lista desde cero.
          await onStructuralRebuild(result.newFieldCount ?? 0);
          return;
        }
        await refreshList();
        await loadDetail();
      }
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  if (loading) return <div className="detail-panel dim">Cargando campo…</div>;
  if (!detail) {
    return <div className="detail-panel error-text">{error ?? "No se pudo cargar el campo."}</div>;
  }

  const inference = detail.nil ? detail.nilInference : undefined;

  return (
    <div className="detail-panel">
      <div className="detail-header">
        <h3>{detail.path}</h3>
        <button className="close-btn" onClick={() => selectField(null)}>
          ×
        </button>
      </div>
      <p className="dim small">Ranura: {detail.slotKeys.join("  |  ")}</p>

      <div className="current-value">
        <span className="label">Valor actual: </span>
        {detail.nil ? (
          <span className="tag t-nil">nil</span>
        ) : (
          <span className={typeColorClass(detail.value?.kind ?? detail.type)}>{detail.value?.display}</span>
        )}
      </div>

      {inference && (
        <div className="inference-box">
          <p className="label">Inferencia de tipo:</p>
          {inference.candidates.length === 0 && <p className="dim">Sin evidencia de tipo.</p>}
          {inference.candidates.map((c, i) => (
            <div key={c.type} className="candidate">
              <span className={"tag " + confidenceClass(inference.confidence)}>
                {i === 0 ? "Tipo inferido" : "Alternativa"}: {c.type} ({c.scorePct}%)
              </span>
              <ul className="evidence-list dim">
                {c.evidence.map((line, j) => (
                  <li key={j}>{line}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {detail.templates.length > 0 && (
        <p className="dim small">
          Plantillas disponibles:{" "}
          {detail.templates.map((t) => `${t.class} (${t.count}${t.truncated ? "+" : ""})`).join(", ")}
        </p>
      )}

      <div className="editor-box">
        <p className="label">Nuevo valor:</p>
        <p className="dim small">
          {"Prefijos: int: float: str: sym: bool: | nil | [] | {} | copiar [Clase]"}
        </p>
        <div className="row-buttons">
          <input
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit(inputValue, false);
            }}
            placeholder="ej. int:5, str:hola, sym:POTION, nil, [], copiar"
          />
          <button onClick={() => void submit(inputValue, false)}>Aplicar</button>
        </div>
        <div className="row-buttons quick-actions">
          <button onClick={() => void submit("nil", false)}>nil</button>
          <button onClick={() => void submit("[]", false)}>[]</button>
          <button onClick={() => void submit("{}", false)}>{"{}"}</button>
          <button onClick={() => void submit("copiar", false)}>Clonar plantilla…</button>
        </div>
      </div>

      {error && <p className="error-text">{error}</p>}

      {pendingConfirm && (
        <div className="confirm-box">
          <p>{pendingConfirm.message}</p>
          <div className="row-buttons">
            <button onClick={() => void submit(pendingConfirm.retryInput, true)}>Confirmar</button>
            <button onClick={() => setPendingConfirm(null)}>Cancelar</button>
          </div>
        </div>
      )}

      {templateChoice && (
        <div className="template-picker">
          <p>Plantillas de {templateChoice.className}:</p>
          {templateChoice.instances.length === 0 && <p className="dim">No hay instancias disponibles.</p>}
          <ul>
            {templateChoice.instances.map((inst) => (
              <li key={inst.slot}>
                <button
                  onClick={() => void submit(`copiar ${templateChoice.className} ${inst.slot + 1}`, false)}
                >
                  {inst.path}
                </button>
              </li>
            ))}
          </ul>
          <button onClick={() => setTemplateChoice(null)}>Cancelar</button>
        </div>
      )}
    </div>
  );
}
