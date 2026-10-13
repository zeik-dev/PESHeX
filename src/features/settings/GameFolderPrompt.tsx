import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { FolderOpen } from "lucide-react";
import { useState } from "react";
import { useT } from "../../lib/useT";
import { useGame } from "../../stores/game";
import { Button, LoadProgress, Modal } from "../../ui";
import shared from "../shared/shared.module.css";

/** Barra de progreso de la carga de la carpeta del juego (pasos reales del driver, de Rust y del catálogo). */
export function GameLinkProgress() {
  const { dyn } = useT();
  const progress = useGame((s) => s.progress);
  if (!progress) return null;
  const { done, total, step } = progress;
  return <LoadProgress value={total > 0 ? done / total : 0} label={dyn(`game.step.${step}`)} />;
}

/** Aviso al abrir una partida que no tiene carpeta de juego asociada: ofrece elegirla (con progreso) o seguir sin ella. */
export function GameFolderPrompt() {
  const { t } = useT();
  const savePath = useGame((s) => s.prompt);
  const linking = useGame((s) => s.linking);
  const link = useGame((s) => s.link);
  const dismiss = useGame((s) => s.dismissPrompt);
  const [dontAsk, setDontAsk] = useState(false);

  async function add() {
    if (!savePath) return;
    const dir = await openDialog({ directory: true, multiple: false, title: t("game.dialogTitle") });
    if (typeof dir === "string") await link(dir, "manual", savePath);
  }

  const cancel = () => {
    if (linking) return;
    dismiss(dontAsk);
    setDontAsk(false);
  };

  return (
    <Modal
      open={!!savePath}
      title={t("game.prompt.title")}
      onClose={cancel}
      footer={
        <>
          <Button variant="primary" disabled={linking} onClick={() => void add()}>
            <FolderOpen size={16} /> {t("game.prompt.add")}
          </Button>
          <Button disabled={linking} onClick={cancel}>{t("game.prompt.cancel")}</Button>
        </>
      }
    >
      <div className={shared.stack}>
        <p>{t("game.prompt.body")}</p>
        {linking ? (
          <GameLinkProgress />
        ) : (
          <label style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer" }}>
            <input type="checkbox" checked={dontAsk} onChange={(e) => setDontAsk(e.target.checked)} />
            {t("game.prompt.dontAsk")}
          </label>
        )}
      </div>
    </Modal>
  );
}
