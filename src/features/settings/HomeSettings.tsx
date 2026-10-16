import { ChevronLeft } from "lucide-react";
import { useT } from "../../lib/useT";
import { useUi } from "../../stores/ui";
import styles from "../../app/app.module.css";
import { UpdatesCard } from "../updater/UpdatesCard";
import { AboutCard } from "./AboutCard";
import { GamesCard } from "./GamesCard";
import { GeneralCard } from "./GeneralCard";
import { ZoomCard } from "./ZoomCard";

/** Ajustes de la pantalla de inicio: solo lo que no depende de una partida abierta (apariencia, zoom, juegos, actualizaciones y datos de la app). */
export function HomeSettings() {
  const { t } = useT();
  const close = useUi((s) => s.closeHomeSettings);
  return (
    <div className={styles.homePage} data-testid="home-settings">
      <div className={styles.homeBar}>
        <button type="button" className={styles.hbtn} onClick={close}>
          <ChevronLeft size={16} aria-hidden="true" /> {t("common.back")}
        </button>
        <h1 className={styles.homeTitle}>{t("settings.title")}</h1>
      </div>
      <div className={styles.homeScroll}>
        <div className={styles.homeBody}>
          <p className="muted" style={{ margin: 0 }}>{t("settings.homeHint")}</p>
          <GeneralCard />
          <ZoomCard />
          <GamesCard />
          <UpdatesCard />
          <AboutCard />
        </div>
      </div>
    </div>
  );
}
