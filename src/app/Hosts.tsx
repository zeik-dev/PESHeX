import { useTranslation } from "react-i18next";
import { useEdit } from "../stores/edit";
import { useSession } from "../stores/session";
import { ConfirmDialog, Modal, Button } from "../ui";
import { FlagList } from "../features/legality/FlagList";

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

  return (
    <>
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
