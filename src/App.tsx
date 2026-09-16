import { OpenFileScreen } from "./components/OpenFileScreen";
import { FieldBrowser } from "./components/FieldBrowser";
import { FieldDetailPanel } from "./components/FieldDetailPanel";
import { PendingChangesPanel } from "./components/PendingChangesPanel";
import { NilReportView } from "./components/NilReportView";
import { SaveBar } from "./components/SaveBar";
import { useEditorStore } from "./store";
import "./App.css";

function App() {
  const filePath = useEditorStore((s) => s.filePath);
  const openInfo = useEditorStore((s) => s.openInfo);
  const view = useEditorStore((s) => s.view);
  const setView = useEditorStore((s) => s.setView);
  const selectedIndex = useEditorStore((s) => s.selectedIndex);
  const closeFile = useEditorStore((s) => s.closeFile);
  const error = useEditorStore((s) => s.error);
  const setError = useEditorStore((s) => s.setError);

  if (!filePath || !openInfo) {
    return <OpenFileScreen />;
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="file-info">
          <strong>{filePath}</strong>
          <span className="dim small">
            {" "}
            · {openInfo.fieldCount.toLocaleString()} campos ({openInfo.nilCount.toLocaleString()} nil)
            {openInfo.wrapper === "zlib" ? " · zlib" : ""}
            {!openInfo.roundtripClean ? " · reconstrucción no idéntica" : ""}
          </span>
        </div>
        <nav className="tabs">
          <button className={view === "browser" ? "active" : ""} onClick={() => setView("browser")}>
            Campos
          </button>
          <button className={view === "changes" ? "active" : ""} onClick={() => setView("changes")}>
            Cambios
          </button>
          <button className={view === "nilReport" ? "active" : ""} onClick={() => setView("nilReport")}>
            Reporte nil
          </button>
        </nav>
        <SaveBar />
        <button onClick={() => void closeFile()}>Cerrar archivo</button>
      </header>

      {error && (
        <div className="global-error">
          {error}
          <button onClick={() => setError(null)}>×</button>
        </div>
      )}

      <main className="app-main">
        {view === "browser" && (
          <div className="browser-layout">
            <FieldBrowser />
            {selectedIndex != null && <FieldDetailPanel key={selectedIndex} index={selectedIndex} />}
          </div>
        )}
        {view === "changes" && <PendingChangesPanel />}
        {view === "nilReport" && <NilReportView />}
      </main>
    </div>
  );
}

export default App;
