import { useGame } from "../../stores/game";
import { internalId } from "../../game/lookup";
import { useItemOptions } from "../../game/useCatalog";
import { ComboBox, TextField } from "../../ui";

/** Selector de objetos con busqueda: nombre, icono e id (y numero en bases antiguas). Sin carpeta del juego vinculada
 *  cae a un campo de texto con el id interno. `value` puede ser el id del save (texto o numero de bases <= v18); el
 *  cambio devuelve siempre el id INTERNO (el driver lo convierte al numero cuando el save lo guarda asi). */
export function ItemPicker({
  id,
  value,
  onChange,
  pocket,
  ariaLabel,
  placeholder,
  disabled,
  nullable = true,
  allowCustom = true,
}: {
  id?: string;
  value: string | number | null | undefined;
  onChange: (id: string | null) => void;
  pocket?: number | null;
  ariaLabel?: string;
  placeholder?: string;
  disabled?: boolean;
  nullable?: boolean;
  allowCustom?: boolean;
}) {
  const options = useItemOptions(pocket);
  const index = useGame((s) => s.catalogIndex);
  const internal = internalId(index, "items", value);
  if (!options) {
    return (
      <TextField
        id={id}
        value={value == null ? null : String(value)}
        onCommit={(v) => onChange(v ? v.trim().toUpperCase() : null)}
        nullable={nullable}
        disabled={disabled}
        ariaLabel={ariaLabel}
        placeholder={placeholder}
        mono
      />
    );
  }
  return (
    <ComboBox
      id={id}
      value={internal}
      options={options}
      onChange={onChange}
      disabled={disabled}
      ariaLabel={ariaLabel}
      placeholder={placeholder}
      nullable={nullable}
      allowCustom={allowCustom}
    />
  );
}
