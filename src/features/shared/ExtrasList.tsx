import { useT } from "../../lib/useT";
import type { Extra } from "../../api/types";
import { NumberField, Switch, TextField, Chip } from "../../ui";
import { useEdit } from "../../stores/edit";
import styles from "./shared.module.css";

/** Datos de una entidad que no tienen control propio. Los estandar de
 *  Essentials y los personalizados de la base se muestran por separado; los
 *  valores simples se pueden editar aqui mismo. */
export function ExtrasList({ ref_, extras, readOnly }: { ref_: string; extras: Extra[]; readOnly?: boolean }) {
  const { t } = useT();
  const apply = useEdit((s) => s.apply);

  if (extras.length === 0) return null;

  function edit(extra: Extra, value: string | number | boolean | null) {
    void apply([{ op: "extra.set", ref: ref_, ivar: extra.name, value }]);
  }

  function cell(extra: Extra) {
    const disabled = readOnly || !extra.editable;
    switch (extra.kind) {
      case "int":
        return <NumberField value={extra.value as number} disabled={disabled} ariaLabel={extra.name} onCommit={(n) => edit(extra, n)} />;
      case "bool":
        return <Switch checked={extra.value === true} disabled={disabled} label={extra.name} onChange={(v) => edit(extra, v)} />;
      case "str":
      case "sym":
        return <TextField value={String(extra.value ?? "")} disabled={disabled} ariaLabel={extra.name} onCommit={(v) => edit(extra, v ?? "")} />;
      case "float":
        return (
          <TextField
            value={String(extra.value ?? "")}
            disabled={disabled}
            ariaLabel={extra.name}
            onCommit={(v) => {
              const n = Number(v);
              if (Number.isFinite(n)) edit(extra, n);
            }}
          />
        );
      default:
        return <span className="muted mono">{extra.display}</span>;
    }
  }

  return (
    <table className={styles.extras}>
      <thead>
        <tr>
          <th>{t("common.path")}</th>
          <th>{t("common.kind")}</th>
          <th>{t("common.value")}</th>
        </tr>
      </thead>
      <tbody>
        {extras.map((e) => (
          <tr key={e.name}>
            <td>
              <span className={styles.extrasName}>{e.name}</span>{" "}
              {e.custom && <Chip tone="info">{t("common.custom")}</Chip>}
            </td>
            <td className="muted">{e.kind}</td>
            <td style={{ minWidth: 160 }}>{cell(e)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
