import { useEffect, useState } from "react";
import { driver, errorMessage, type ChangeEntry } from "../api/driver";
import { typeColorClass } from "../typeColors";

export function PendingChangesPanel() {
  const [changes, setChanges] = useState<ChangeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        const result = await driver.listChanges();
        setChanges(result.changes);
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <div className="dim">Cargando cambios…</div>;
  if (error) return <p className="error-text">{error}</p>;
  if (changes.length === 0) return <p className="dim">No hay cambios pendientes.</p>;

  return (
    <div className="changes-panel">
      <h3>{changes.length} cambio(s) pendiente(s)</h3>
      <table>
        <thead>
          <tr>
            <th>Ruta</th>
            <th>Antes</th>
            <th>Después</th>
          </tr>
        </thead>
        <tbody>
          {changes.map((c) => (
            <tr key={c.path}>
              <td>{c.path}</td>
              <td className={typeColorClass(c.old.kind)}>{c.old.display}</td>
              <td className={typeColorClass(c.new.kind)}>{c.new.display}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
