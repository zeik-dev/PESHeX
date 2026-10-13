import { useEffect, useState } from "react";
import { NumberField } from "./controls";
import styles from "./ui.module.css";

/** Deslizador + campo numerico para el mismo valor. Mientras se arrastra solo cambia la vista; el cambio se
 *  CONFIRMA (un unico `onCommit`) al soltar, al levantar la tecla o al salir del control, de modo que un gesto
 *  es una sola edicion (y un solo "deshacer"). El campo numerico admite escribir el valor exacto y, con
 *  `numberMin`/`numberMax`, valores fuera del recorrido del deslizador (p. ej. 0 PS = debilitado). */
export function SliderField({
  id,
  value,
  min,
  max,
  onCommit,
  ariaLabel,
  sliderLabel,
  disabled,
  step = 1,
  numberMin,
  numberMax,
  numberWidth = 64,
  valueText,
}: {
  /** `id` del campo numerico (para enlazarlo con su etiqueta). */
  id?: string;
  value: number | null | undefined;
  min: number;
  max: number;
  onCommit: (n: number) => void;
  ariaLabel: string;
  /** Nombre accesible del deslizador (por defecto «<ariaLabel> (deslizador)», distinto del campo numerico). */
  sliderLabel?: string;
  disabled?: boolean;
  step?: number;
  numberMin?: number;
  numberMax?: number;
  numberWidth?: number | string;
  valueText?: (n: number) => string;
}) {
  const current = value ?? min;
  const [draft, setDraft] = useState<number | null>(null);
  useEffect(() => setDraft(null), [value]);
  const shown = Math.min(max, Math.max(min, draft ?? current));
  const span = max - min;
  const pct = span > 0 ? ((shown - min) / span) * 100 : 0;

  function commit() {
    if (draft != null && draft !== value) onCommit(draft);
    setDraft(null);
  }

  return (
    <div className={styles.sliderRow}>
      <input
        type="range"
        className={styles.slider}
        style={{ ["--pct" as string]: `${pct}%` }}
        min={min}
        max={max}
        step={step}
        value={shown}
        disabled={disabled}
        aria-label={sliderLabel ?? `${ariaLabel} (deslizador)`}
        aria-valuetext={valueText ? valueText(shown) : undefined}
        onChange={(e) => setDraft(Number(e.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
      />
      <NumberField
        id={id}
        value={draft ?? value}
        onCommit={onCommit}
        min={numberMin ?? min}
        max={numberMax ?? max}
        disabled={disabled}
        ariaLabel={ariaLabel}
        width={numberWidth}
      />
    </div>
  );
}
