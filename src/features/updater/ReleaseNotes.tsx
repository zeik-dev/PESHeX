import type { ReactNode } from "react";
import styles from "./updater.module.css";

/** `**negrita**` y `` `codigo` `` como nodos de React (nunca HTML en crudo: las notas vienen de internet). */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) return <code key={i} className="mono">{part.slice(1, -1)}</code>;
    return part;
  });
}

/** Notas del Release (Markdown basico: titulos, listas, negrita y codigo) sin dependencias. */
export function ReleaseNotes({ notes }: { notes: string }) {
  const blocks: ReactNode[] = [];
  let items: string[] = [];
  const flush = () => {
    if (items.length) {
      blocks.push(<ul key={`u${blocks.length}`}>{items.map((it, i) => <li key={i}>{inline(it)}</li>)}</ul>);
      items = [];
    }
  };
  for (const raw of notes.split(/\r?\n/)) {
    const line = raw.trim();
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (bullet) items.push(bullet[1] ?? "");
    else {
      flush();
      if (heading) blocks.push(<h4 key={`h${blocks.length}`}>{inline(heading[1] ?? "")}</h4>);
      else if (line && !line.startsWith(">")) blocks.push(<p key={`p${blocks.length}`}>{inline(line)}</p>);
    }
  }
  flush();
  return <div className={styles.notes} data-testid="update-notes">{blocks}</div>;
}
