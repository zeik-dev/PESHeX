import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import styles from "./ui.module.css";
import { cx } from "./cx";
import { Button } from "./controls";
import { useToasts } from "../stores/toasts";

function useEscape(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
}

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEscape(open, onClose);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) ref.current?.focus();
  }, [open]);
  if (!open) return null;
  return (
    <div className={cx(styles.overlay, styles.overlayCenter)} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} tabIndex={-1} className={styles.modal} role="dialog" aria-modal="true" aria-label={title}>
        <div className={styles.modalHead}>{title}</div>
        <div className={styles.modalBody}>{children}</div>
        {footer && <div className={styles.modalFoot}>{footer}</div>}
      </div>
    </div>
  );
}

export function Drawer({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  useEscape(open, onClose);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) ref.current?.focus();
  }, [open]);
  if (!open) return null;
  return (
    <div className={cx(styles.overlay, styles.overlayRight)} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside ref={ref} tabIndex={-1} className={styles.drawer} role="dialog" aria-modal="true" aria-label={title}>
        <div style={{ display: "flex", justifyContent: "flex-end", padding: "8px 8px 0" }}>
          <Button variant="ghost" size="sm" icon onClick={onClose} aria-label={t("pokemon.close")} title={t("pokemon.close")}>
            <X size={18} />
          </Button>
        </div>
        {children}
      </aside>
    </div>
  );
}

export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  onConfirm,
  onCancel,
  danger,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  danger?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Modal
      open={open}
      title={title}
      onClose={onCancel}
      footer={
        <>
          <Button onClick={onCancel}>{t("common.cancel")}</Button>
          <Button variant={danger ? "danger" : "primary"} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Modal>
  );
}

export function Banner({
  tone,
  title,
  children,
  action,
}: {
  tone: "warn" | "bad" | "info";
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  const toneClass = { warn: styles.bannerWarn, bad: styles.bannerBad, info: styles.bannerInfo }[tone];
  return (
    <div className={cx(styles.banner, toneClass)} role="status">
      <div className={styles.bannerBody}>
        <div className={styles.bannerTitle}>{title}</div>
        {children && <div>{children}</div>}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <div className={styles.empty}>
      {icon}
      <div>{children}</div>
    </div>
  );
}

export function Toasts() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);
  return (
    <div className={styles.toasts} aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={cx(styles.toast, t.kind !== "success" && styles[`toast_${t.kind}` as "toast_error"])} role="status">
          <div style={{ flex: 1 }}>
            <div>{t.text}</div>
            {t.detail && <div className={styles.toastDetail}>{t.detail}</div>}
          </div>
          <button
            type="button"
            onClick={() => dismiss(t.id)}
            aria-label="×"
            style={{ background: "transparent", border: 0, color: "inherit", cursor: "pointer" }}
          >
            <X size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}
