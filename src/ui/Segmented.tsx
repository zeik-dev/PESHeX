import styles from "./ui.module.css";
import { cx } from "./cx";

/** Control segmentado de elección única (`radiogroup`): para alternar entre dos o tres vistas del mismo contenido. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  className,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <div className={cx(styles.segmented, className)} role="radiogroup" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={cx(styles.segBtn, value === o.value && styles.segOn)}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
