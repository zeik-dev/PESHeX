import { useTranslation } from "react-i18next";
import { issueText } from "../lib/errors";
import { useEdit } from "../stores/edit";
import { useSession } from "../stores/session";
import { ConfirmDialog } from "../ui";
import type { Issue } from "../api/types";

function IssueList({ issues }: { issues: Issue[] }) {
  const { t } = useTranslation();
  return (
    <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
      {issues.map((i, n) => (
        <li key={n} style={{ color: i.severity === "error" ? "var(--danger)" : "var(--warning)" }}>
          {issueText(t, i)}
        </li>
      ))}
    </ul>
  );
}

/** Dialogos globales: confirmar valores fuera de rango, guardar con avisos y
 *  cerrar con cambios pendientes. */
export function Hosts() {
  const { t } = useTranslation();
  const confirm = useEdit((s) => s.confirm);
  const confirmApply = useEdit((s) => s.confirmApply);
  const dismissEdit = useEdit((s) => s.dismiss);

  const saveConfirm = useSession((s) => s.saveConfirm);
  const save = useSession((s) => s.save);
  const dismissSave = useSession((s) => s.dismissSaveConfirm);

  const closeConfirm = useSession((s) => s.closeConfirm);
  const close = useSession((s) => s.close);
  const dismissClose = useSession((s) => s.dismissCloseConfirm);

  return (
    <>
      <ConfirmDialog
        open={!!confirm}
        title={t("issues.confirmTitle")}
        confirmLabel={t("common.applyAnyway")}
        onConfirm={() => void confirmApply()}
        onCancel={dismissEdit}
      >
        <p>{t("issues.confirmBody")}</p>
        {confirm && <IssueList issues={confirm.issues} />}
      </ConfirmDialog>

      <ConfirmDialog
        open={!!saveConfirm}
        title={saveConfirm?.reason === "roundtrip_diff" ? t("save.roundtripTitle") : t("save.issuesTitle")}
        confirmLabel={t("common.save")}
        onConfirm={() => void save(true)}
        onCancel={dismissSave}
      >
        <p>{saveConfirm?.reason === "roundtrip_diff" ? t("save.roundtripBody") : t("save.issuesBody")}</p>
        {saveConfirm && saveConfirm.issues.length > 0 && <IssueList issues={saveConfirm.issues} />}
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
