/**
 * Tile color picker: a native radio group rendered as swatches.
 *
 * Native radios give keyboard behaviour (arrow keys move and select) and
 * screen-reader semantics for free; each swatch is labelled with its colour
 * name. The selected swatch shows a check mark, so selection never relies on
 * colour alone.
 */
import { CheckIcon } from '../../components/icons.tsx'
import { TILE_COLORS } from './tileColors.ts'

export interface ColorPickerProps {
  value: string
  onChange: (colorId: string) => void
  /** Radio group name; must be unique on the page. */
  name: string
  legend?: string
}

export function ColorPicker({ value, onChange, name, legend = 'Tile color' }: ColorPickerProps) {
  return (
    <fieldset className="color-picker">
      <legend className="field__label">{legend}</legend>
      <div className="color-picker__swatches">
        {TILE_COLORS.map((color) => (
          <label key={color.id} className="color-picker__swatch" style={{ background: color.background, color: color.text }}>
            <input
              type="radio"
              className="color-picker__input"
              name={name}
              value={color.id}
              checked={value === color.id}
              onChange={() => onChange(color.id)}
              aria-label={color.label}
            />
            {value === color.id && <CheckIcon />}
          </label>
        ))}
      </div>
    </fieldset>
  )
}
