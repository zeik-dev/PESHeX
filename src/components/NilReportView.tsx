import { useEffect, useState } from "react";
import { driver, errorMessage, type NilReportResult } from "../api/driver";
import { confidenceClass } from "../typeColors";

export function NilReportView() {
  const [report, setReport] = useState<NilReportResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        setReport(await driver.nilReport());
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <div className="dim">Generando reporte…</div>;
  if (error) return <p className="error-text">{error}</p>;
  if (!report) return null;

  return (
    <div className="nil-report">
      <div className="nil-summary">
        <span className="tag conf-alta">alta {report.summary.alta}</span>
        <span className="tag conf-media">media {report.summary.media}</span>
        <span className="tag conf-baja">baja {report.summary.baja}</span>
        <span className="tag conf-none">sin tipo {report.summary.sin}</span>
      </div>
      <table>
        <thead>
          <tr>
            <th>Ranura</th>
            <th>Cantidad</th>
            <th>Tipo inferido</th>
            <th>Confianza</th>
            <th>Evidencia</th>
          </tr>
        </thead>
        <tbody>
          {report.groups.map((g) => (
            <tr key={g.slotKey}>
              <td>{g.slotKey}</td>
              <td>{g.count}</td>
              <td>{g.inferredType ?? "?"}</td>
              <td className={confidenceClass(g.confidence)}>{g.confidence ?? "-"}</td>
              <td className="dim small">{g.topEvidence ?? "sin evidencia"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
