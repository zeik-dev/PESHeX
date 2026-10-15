import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { FolderOpen, Languages } from "lucide-react";
import { useState } from "react";
import { effectiveLang, useSettings } from "../../stores/settings";
import { useGames } from "../../stores/games";
import { useT } from "../../lib/useT";
import { Button, Modal, cx } from "../../ui";
import styles from "./settings.module.css";

type Step = "lang" | "game";

/** Asistente del primer arranque. Paso 1: el idioma (por defecto español; se aplica al instante, el propio asistente cambia de
 *  idioma al elegir). Paso 2: agregar un directorio de juego a «Mis juegos» (opcional). Se muestra una sola vez; quien ya usaba
 *  la app (ajustes anteriores) no pasa por él. */
export function FirstRunWizard() {
  const { t } = useT();
  const done = useSettings((s) => s.firstRunDone);
  const pref = useSettings((s) => s.lang);
  const setLang = useSettings((s) => s.setLang);
  const finish = useSettings((s) => s.setFirstRunDone);
  const addGame = useGames((s) => s.add);
  const scans = useGames((s) => s.scans);
  const [step, setStep] = useState<Step>("lang");
  const [added, setAdded] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const current = effectiveLang(pref);

  async function pick() {
    const dir = await openDialog({ directory: true, multiple: false, title: t("games.pickDialog") });
    if (typeof dir !== "string") return;
    setBusy(true);
    const g = await addGame(dir);
    setBusy(false);
    if (g) setAdded({ id: g.id, name: g.name });
  }

  const footer =
    step === "lang" ? (
      <Button variant="primary" onClick={() => setStep("game")}>
        {t("firstRun.next")}
      </Button>
    ) : (
      <>
        {!added && (
          <Button variant="primary" disabled={busy} onClick={() => void pick()}>
            <FolderOpen size={16} /> {t("firstRun.gameAdd")}
          </Button>
        )}
        <Button variant={added ? "primary" : "secondary"} disabled={busy} onClick={() => finish(true)}>
          {added ? t("firstRun.finish") : t("firstRun.gameSkip")}
        </Button>
      </>
    );

  return (
    <Modal open={!done} title={step === "lang" ? t("firstRun.title") : t("firstRun.gameTitle")} onClose={() => finish(true)} footer={footer}>
      {step === "lang" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <p style={{ margin: 0 }}>{t("firstRun.langBody")}</p>
          <div className={styles.langChoices} role="radiogroup" aria-label={t("firstRun.langLabel")}>
            {(["es", "en"] as const).map((l) => (
              <button
                key={l}
                type="button"
                role="radio"
                aria-checked={current === l}
                className={cx(styles.langChoice, current === l && styles.langChoiceOn)}
                onClick={() => setLang(l)}
              >
                <Languages size={18} aria-hidden="true" />
                {l === "es" ? "Español" : "English"}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <p style={{ margin: 0 }}>{t("firstRun.gameBody")}</p>
          {added && (
            <p style={{ margin: 0, fontWeight: 700 }} role="status" data-testid="first-run-added">
              {t("firstRun.gameAdded", { name: added.name, count: scans[added.id]?.files.length ?? 0 })}
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}
