/**
 * Optional category icon picker (v0.6.0): None plus the eight categories in
 * cardIcons.ts, as a native radio group.
 *
 * Mirrors ColorPicker: native radios give arrow-key selection and
 * screen-reader semantics; the visible input is hidden over each option so
 * the whole option is the touch target. Unlike colour swatches, every option
 * carries a visible text label (category names are not self-evident from
 * small artwork alone), and the radio's accessible name is that label.
 *
 * Each option previews the icon on the currently chosen tile colour, so the
 * user sees exactly what the tile will look like (the icon takes the
 * palette's text color, as on the tile). The selected option gets a
 * thick ring (shape, not colour alone, marks selection).
 *
 * `value` null means None; the picker never chooses an icon by itself.
 */
import type { CSSProperties } from 'react'
import { CARD_ICONS, type CardIconId } from './cardIcons.ts'
import { CardCategoryIcon } from './CardCategoryIcon.tsx'
import { tileColor } from './tileColors.ts'

export interface IconPickerProps {
  value: CardIconId | null
  onChange: (icon: CardIconId | null) => void
  /** Tile colour id used as the preview background. */
  color: string
  /** Radio group name; must be unique on the page. */
  name: string
  legend?: string
}

export function IconPicker({ value, onChange, color, name, legend = 'Icon' }: IconPickerProps) {
  const colors = tileColor(color)
  const swatchStyle: CSSProperties = { background: colors.background, color: colors.text }
  const options: Array<{ id: CardIconId | null; label: string }> = [{ id: null, label: 'None' }, ...CARD_ICONS]

  return (
    <fieldset className="icon-picker">
      <legend className="field__label">{legend}</legend>
      <div className="icon-picker__options">
        {options.map((option) => {
          const checked = value === option.id
          return (
            <label key={option.id ?? 'none'} className="icon-picker__option">
              <input
                type="radio"
                className="icon-picker__input"
                name={name}
                value={option.id ?? 'none'}
                checked={checked}
                onChange={() => onChange(option.id)}
              />
              <span className="icon-picker__swatch" style={swatchStyle} aria-hidden="true">
                {option.id && <CardCategoryIcon icon={option.id} className="icon-picker__icon" />}
              </span>
              <span className="icon-picker__label">{option.label}</span>
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}
