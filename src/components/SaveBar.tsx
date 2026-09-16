import { useState } from "react";
import { driver, errorMessage } from "../api/driver";
import { useEditorStore } from "../store";

export function SaveBar() {
  const pendingCount = useEditorStore((s) => s.pendingCount);
  const refreshList = useEditorStore((s) => s.refreshList);

  const [backup, setBackup] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<string | null>(null);

  async function doSave(confirmed: boolean) {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const result = await driver.save(backup, confirmed);
      if (result.needsConfirmation) {
        setPendingConfirm(result.message ?? "¿Confirmar guardado?");
        return;
      }
      setPendingConfirm(null);
      if (result.applied) {
        setMessage(
          `Guardado: ${result.changesApplied} cambio(s), ${result.bytesWritten} bytes` +
            (result.backupPath ? ` · backup: ${result.backupPath}` : ""),
        );
        await refreshList();
      } else if (result.reason === "no_changes") {
        setMessage("No hay cambios para guardar.");
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="save-bar">
      <label className="dim small">
        <input type="checkbox" checked={backup} onChange={(e) => setBackup(e.target.checked)} />
        Copia .bak
      </label>
      <button disabled={saving || pendingCount === 0} onClick={() => void doSave(false)}>
        {saving ? "Guardando…" : `Guardar (${pendingCount})`}
      </button>
      {message && <span className="dim small">{message}</span>}
      {error && <span className="error-text small">{error}</span>}
      {pendingConfirm && (
        <div className="confirm-box">
          <p>{pendingConfirm}</p>
          <div className="row-buttons">
            <button onClick={() => void doSave(true)}>Confirmar y guardar</button>
            <button onClick={() => setPendingConfirm(null)}>Cancelar</button>
          </div>
        </div>
      )}
    </div>
  );
}
