import { useSession } from "../stores/session";
import { Toasts } from "../ui";
import { Advanced } from "../features/advanced/Advanced";
import { Bag } from "../features/bag/Bag";
import { Backups } from "../features/backups/Backups";
import { Boxes } from "../features/boxes/Boxes";
import { Changes } from "../features/changes/Changes";
import { Overview } from "../features/overview/Overview";
import { Party } from "../features/party/Party";
import { Pokedex } from "../features/pokedex/Pokedex";
import { PokemonEditorHost } from "../features/pokemon/PokemonEditor";
import { Settings } from "../features/settings/Settings";
import { Trainer } from "../features/trainer/Trainer";
import { Unclassified } from "../features/unclassified/Unclassified";
import { World } from "../features/world/World";
import { ExportDialog } from "../features/transfer/ExportDialog";
import { ImportDialog } from "../features/transfer/ImportDialog";
import { CommandPalette } from "../features/palette/CommandPalette";
import { ShortcutsHost } from "../features/palette/ShortcutsHost";
import { Hosts } from "./Hosts";
import { OpenScreen } from "./OpenScreen";
import { HaxStrip } from "./ModeSwitch";
import { PokeHeader } from "./PokeHeader";
import styles from "./app.module.css";

function CurrentView() {
  const view = useSession((s) => s.view);
  switch (view) {
    case "overview": return <Overview />;
    case "trainer": return <Trainer />;
    case "party": return <Party />;
    case "boxes": return <Boxes />;
    case "bag": return <Bag />;
    case "pokedex": return <Pokedex />;
    case "world": return <World />;
    case "unclassified": return <Unclassified />;
    case "changes": return <Changes />;
    case "backups": return <Backups />;
    case "advanced": return <Advanced />;
    case "settings": return <Settings />;
  }
}

export default function App() {
  const filePath = useSession((s) => s.filePath);
  return (
    <>
      {filePath ? (
        <div className={styles.shell}>
          <PokeHeader />
          <HaxStrip />
          <main className={styles.main}>
            <div className={styles.content}>
              <CurrentView />
            </div>
          </main>
          <PokemonEditorHost />
          <ExportDialog />
          <ImportDialog />
          <CommandPalette />
          <ShortcutsHost />
        </div>
      ) : (
        <OpenScreen />
      )}
      <Hosts />
      <Toasts />
    </>
  );
}
