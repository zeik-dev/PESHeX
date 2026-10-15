import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useEdit } from "../stores/edit";
import { useGame } from "../stores/game";
import { useGames } from "../stores/games";
import { useSession } from "../stores/session";
import { useUi } from "../stores/ui";
import { ConfirmDialog, Modal, Button, Banner, Chip } from "../ui";
import { FlagList } from "../features/legality/FlagList";
import { FirstRunWizard } from "../features/settings/FirstRunWizard";
import { GameFolderPrompt } from "../features/settings/GameFolderPrompt";

/** Aviso previo a activar HeX: depende de la carpeta del juego y puede equivocarse en algunos fangames. */
function HexWarning() {
  const { t } = useTranslation();
  const open = useUi((s) => s.hexConfirm);
  const setOpen = useUi((s) => s.setHexConfirm);
  const changeMode = useSession((s) => s.changeMode);
  const filePath = useSession((s) => s.filePath);
  const setView = useSession((s) => s.setView);
  const linked = useGame((s) => s.status.linked);
  const legality = useGame((s) => s.status.legality);
  const close = () => setOpen(false);

  return (
    <Modal
      open={open}
      title={t("mode.warn.title")}
      onClose={close}
      footer={
        <>
          <Button variant="primary" onClick={() => { close(); void changeMode("hex"); }}>{t("mode.warn.confirm")}</Button>
          {filePath && !linked && (
            <Button onClick={() => { close(); setView("settings"); }}>{t("mode.warn.link")}</Button>
          )}
          <Button onClick={close}>{t("common.cancel")}</Button>
        </>
      }
    >
      <p>{t("mode.warn.intro")}</p>
      <ul style={{ margin: "8px 0", paddingLeft: 20, display: "flex", flexDirection: "column", gap: 6 }}>
        <li>{t("mode.warn.needsGame")}</li>
        <li>{t("mode.warn.canFail")}</li>
        <li>{t("mode.warn.fallback")}</li>
      </ul>
      {filePath && (
        <Banner tone={linked && legality.level === "full" ? "info" : "warn"} title={linked ? t("mode.warn.linkedTitle") : t("mode.warn.unlinkedTitle")}>
          {linked ? (
            <span>
              <Chip tone={legality.level === "full" ? "good" : "warn"}>{t(`game.level.${legality.level}`)}</Chip>{" "}
              {t(`game.levelHelp.${legality.level}`)}
            </span>
          ) : (
            t("mode.warn.unlinkedBody")
          )}
        </Banner>
      )}
    </Modal>
  );
}

/** Dialogos globales: rechazo de HeX, guardar con un archivo que no se reconstruye identico y
 *  cerrar con cambios pendientes. (En HaX no hay confirmaciones de validacion: se permite todo.) */
export function Hosts() {
  const { t } = useTranslation();
  const rejected = useEdit((s) => s.rejected);
  const dismissRejected = useEdit((s) => s.dismiss);
  const changeMode = useSession((s) => s.changeMode);

  const saveConfirm = useSession((s) => s.saveConfirm);
  const save = useSession((s) => s.save);
  const dismissSave = useSession((s) => s.dismissSaveConfirm);

  const closeConfirm = useSession((s) => s.closeConfirm);
  const close = useSession((s) => s.close);
  const dismissClose = useSession((s) => s.dismissCloseConfirm);

  // Biblioteca «Mis juegos»: se carga al arrancar (y escucha el progreso de «Precargar»).
  useEffect(() => {
    void useGames.getState().init();
  }, []);

  return (
    <>
      <HexWarning />
      <FirstRunWizard />
      <GameFolderPrompt />
      <Modal
        open={!!rejected}
        title={rejected?.where === "save" ? t("mode.rejectedSaveTitle") : t("mode.rejectedTitle")}
        onClose={dismissRejected}
        footer={
          <>
            <Button variant="primary" onClick={dismissRejected}>{t("common.accept")}</Button>
            <Button onClick={() => { dismissRejected(); void changeMode("hax"); }}>{t("mode.switchToHax")}</Button>
          </>
        }
      >
        <p>{rejected?.where === "save" ? t("mode.rejectedSaveBody") : t("mode.rejectedBody")}</p>
        {rejected && <FlagList flags={rejected.flags} showRef />}
      </Modal>

      <ConfirmDialog
        open={!!saveConfirm}
        title={t("save.roundtripTitle")}
        confirmLabel={t("common.save")}
        onConfirm={() => void save(true)}
        onCancel={dismissSave}
      >
        <p>{t("save.roundtripBody")}</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={closeConfirm}
        danger
        title={t("confirmClose.title")}
        confirmLabel={t("confirmClose.confirm")}
        onConfirm={() => {
          dismissClose();
          void close(true);
        }}
        onCancel={dismissClose}
      >
        <p>{t("confirmClose.body")}</p>
      </ConfirmDialog>
    </>
  );
}
