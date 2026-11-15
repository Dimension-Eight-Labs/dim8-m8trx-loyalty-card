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
 * palette's text color, as on the tile).
 *
 * Selection (v0.6.1 consistency pass): the selected option shows the same
 * check mark (CheckIcon) as the selected colour swatch, drawn as a small badge
 * in the swatch corner so it does not cover the artwork. A shape, not colour
 * alone, marks selection, and None gets the same badge on its empty swatch.
 * The badge is absolutely positioned (see app.css), so selected and
 * unselected swatches have identical dimensions. The thick inset ring used
 * before was removed after iPhone testing.
 *
 * `value` null means None; the picker never chooses an icon by itself.
 */
import type { CSSProperties } from 'react'
import { CheckIcon } from '../../components/icons.tsx'
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
  // --swatch-bg lets the check badge draw its check in the swatch colour.
  const swatchStyle = { background: colors.background, color: colors.text, '--swatch-bg': colors.background } as CSSProperties
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
                {checked && (
                  <span className="icon-picker__check" data-testid="icon-picker-check">
                    <CheckIcon />
                  </span>
                )}
              </span>
              <span className="icon-picker__label">{option.label}</span>
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}
