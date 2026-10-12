import { useSession } from "../stores/session";
import { Toasts } from "../ui";
import { Advanced } from "../features/advanced/Advanced";
import { Bag } from "../features/bag/Bag";
import { Boxes } from "../features/boxes/Boxes";
import { Changes } from "../features/changes/Changes";
import { Overview } from "../features/overview/Overview";
import { Party } from "../features/party/Party";
import { PokemonEditorHost } from "../features/pokemon/PokemonEditor";
import { Settings } from "../features/settings/Settings";
import { Trainer } from "../features/trainer/Trainer";
import { Unclassified } from "../features/unclassified/Unclassified";
import { Hosts } from "./Hosts";
import { OpenScreen } from "./OpenScreen";
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
    case "unclassified": return <Unclassified />;
    case "changes": return <Changes />;
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
          <main className={styles.main}>
            <div className={styles.content}>
              <CurrentView />
            </div>
          </main>
          <PokemonEditorHost />
        </div>
      ) : (
        <OpenScreen />
      )}
      <Hosts />
      <Toasts />
    </>
  );
}
