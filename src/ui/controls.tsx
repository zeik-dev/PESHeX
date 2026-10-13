import { useEffect, useId, useState, type ButtonHTMLAttributes, type ReactNode, type Ref } from "react";
import styles from "./ui.module.css";
import { cx } from "./cx";

type Variant = "primary" | "secondary" | "ghost" | "danger";

export function Button({
  variant = "secondary",
  size = "md",
  icon,
  className,
  children,
  ref,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md"; icon?: boolean; ref?: Ref<HTMLButtonElement> }) {
  return (
    <button
      ref={ref}
      type="button"
      className={cx(styles.btn, styles[variant], size === "sm" && styles.sm, icon && styles.iconOnly, className)}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Chip({
  tone,
  children,
  title,
}: {
  tone?: "good" | "warn" | "bad" | "info" | "accent";
  children: ReactNode;
  title?: string;
}) {
  const toneClass = tone && { good: styles.chipGood, warn: styles.chipWarn, bad: styles.chipBad, info: styles.chipInfo, accent: styles.chipAccent }[tone];
  return (
    <span className={cx(styles.chip, toneClass)} title={title}>
      {children}
    </span>
  );
}

/** Etiqueta + control accesibles. */
export function Field({ label, hint, children }: { label: string; hint?: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className={styles.field}>
      <label className={styles.fieldLabel} htmlFor={id}>
        {label}
      </label>
      {children(id)}
      {hint && <span className="muted" style={{ fontSize: 12 }}>{hint}</span>}
    </div>
  );
}

/** Entero editable: confirma con Enter o al salir; Esc revierte. Los limites
 *  (min/max) son solo orientativos: el driver decide si pide confirmacion. */
export function NumberField({
  id,
  value,
  onCommit,
  min,
  max,
  disabled,
  ariaLabel,
  width,
}: {
  id?: string;
  value: number | null | undefined;
  onCommit: (n: number) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
  ariaLabel?: string;
  width?: number | string;
}) {
  const shown = value == null ? "" : String(value);
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);

  const parsed = text.trim() === "" ? null : Number(text);
  const valid = parsed != null && Number.isInteger(parsed);
  const outside = valid && ((min != null && parsed < min) || (max != null && parsed > max));

  function commit() {
    if (!valid) {
      setText(shown);
      return;
    }
    if (parsed !== value) onCommit(parsed);
  }

  return (
    <input
      id={id}
      className={cx(styles.input, styles.number, outside && styles.inputWarn)}
      style={width ? { width } : undefined}
      inputMode="numeric"
      value={text}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-invalid={!valid && text !== "" ? true : undefined}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setText(shown);
      }}
    />
  );
}

export function TextField({
  id,
  value,
  onCommit,
  placeholder,
  disabled,
  nullable,
  ariaLabel,
  mono,
  live,
}: {
  id?: string;
  value: string | null | undefined;
  onCommit: (v: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Si es true, un texto vacio se confirma como `null`. */
  nullable?: boolean;
  ariaLabel?: string;
  mono?: boolean;
  /** Confirma en cada pulsacion (campos que alimentan un boton, no una edicion del save). */
  live?: boolean;
}) {
  const shown = value ?? "";
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);

  function commit() {
    if (text === shown) return;
    if (text === "" && !nullable) {
      setText(shown);
      return;
    }
    onCommit(text === "" ? null : text);
  }

  return (
    <input
      id={id}
      className={cx(styles.input, mono && "mono")}
      value={text}
      placeholder={placeholder}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(e) => {
        setText(e.target.value);
        if (live) onCommit(e.target.value === "" ? null : e.target.value);
      }}
      onBlur={live ? undefined : commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setText(shown);
      }}
    />
  );
}

export function SelectField<T extends string | number>({
  id,
  value,
  options,
  onChange,
  disabled,
  ariaLabel,
}: {
  id?: string;
  value: T | null | undefined;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const known = options.some((o) => o.value === value);
  return (
    <select
      id={id}
      className={styles.input}
      value={value == null ? "" : String(value)}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(e) => {
        const raw = e.target.value;
        const match = options.find((o) => String(o.value) === raw);
        if (match) onChange(match.value);
      }}
    >
      {value != null && !known && <option value={String(value)}>{String(value)}</option>}
      {value == null && <option value="" disabled />}
      {options.map((o) => (
        <option key={String(o.value)} value={String(o.value)}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Switch({
  checked,
  onChange,
  disabled,
  label,
  id,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label: string;
  id?: string;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      disabled={disabled}
      className={styles.switch}
      onClick={() => onChange(!checked)}
    />
  );
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { id: T; label: string; badge?: ReactNode }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className={styles.tabs} role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={tab.id === value}
          className={cx(styles.tab, tab.id === value && styles.tabActive)}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
          {tab.badge != null && <span className={styles.tabBadge}>{tab.badge}</span>}
        </button>
      ))}
    </div>
  );
}
