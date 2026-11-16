/**
 * Tile color picker: a native radio group rendered as labelled swatches.
 *
 * Native radios give keyboard behaviour (arrow keys move and select) and
 * screen-reader semantics for free. Each option shows a flat swatch in the
 * palette background with the approved colour name visible underneath, and
 * the radio's accessible name is that same name. The selected swatch shows a
 * centred check mark in the palette foreground, so selection never relies on
 * colour alone; no ring or border is added, so selected and unselected cells
 * have identical dimensions. Options render in the approved palette order
 * (TILE_COLORS).
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
          <label key={color.id} className="color-picker__option">
            <input
              type="radio"
              className="color-picker__input"
              name={name}
              value={color.id}
              checked={value === color.id}
              onChange={() => onChange(color.id)}
              aria-label={color.label}
            />
            <span
              className="color-picker__swatch"
              data-testid="color-picker-swatch"
              style={{ background: color.background, color: color.text }}
              aria-hidden="true"
            >
              {value === color.id && <CheckIcon />}
            </span>
            <span className="color-picker__label" aria-hidden="true">
              {color.label}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}
