import { useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { driver, errorMessage, type CheckResult } from "../api/driver";
import { useEditorStore } from "../store";

export function OpenFileScreen() {
  const openFile = useEditorStore((s) => s.openFile);
  const loadingOpen = useEditorStore((s) => s.loadingOpen);

  const [checking, setChecking] = useState(false);
  const [pendingPath, setPendingPath] = useState<string | null>(null);
  const [checkResult, setCheckResult] = useState<CheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function pickFile() {
    setError(null);
    const selected = await openDialog({
      multiple: false,
      filters: [{ name: "Save de RPG Maker/Essentials", extensions: ["rxdata"] }],
    });
    if (!selected || Array.isArray(selected)) return;

    setChecking(true);
    try {
      const result = await driver.checkFile(selected);
      setChecking(false);
      if (result.roundtripClean) {
        void openFile(selected);
      } else {
        setPendingPath(selected);
        setCheckResult(result);
      }
    } catch (e) {
      setChecking(false);
      setError(errorMessage(e));
    }
  }

  function proceedAnyway() {
    if (pendingPath) void openFile(pendingPath);
    setPendingPath(null);
    setCheckResult(null);
  }

  return (
    <div className="open-screen">
      <h1>Editor de Saves .rxdata</h1>
      <p className="dim">Pokémon Essentials / RPG Maker XP</p>
      <button onClick={() => void pickFile()} disabled={checking || loadingOpen}>
        {checking ? "Verificando..." : loadingOpen ? "Abriendo..." : "Abrir archivo .rxdata"}
      </button>
      {error && <p className="error-text">{error}</p>}
      {pendingPath && checkResult && (
        <div className="warning-box">
          <p>
            <strong>Atención:</strong> este archivo no se reconstruye idéntico byte a byte (difiere
            desde el byte {checkResult.diffByte}). Los datos se conservan pero la codificación no es
            idéntica.
          </p>
          <div className="row-buttons">
            <button onClick={proceedAnyway}>Abrir de todos modos</button>
            <button
              onClick={() => {
                setPendingPath(null);
                setCheckResult(null);
              }}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
