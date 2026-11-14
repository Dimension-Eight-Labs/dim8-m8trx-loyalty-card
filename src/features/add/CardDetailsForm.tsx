/**
 * Final add-card step: verify the captured barcode, then name the card and
 * pick its tile colour.
 *
 * The preview is the barcode as it will appear at checkout. For generated
 * codes the format and exact value are shown beneath it so the user can
 * compare them with the physical card; this is the only place the value is
 * displayed. The wording is deliberate: a successful redraw is not a promise
 * that every checkout scanner will read it.
 */
import { useId, useRef, useState, type FormEvent } from 'react'
import { ViewHeading } from '../../components/ViewHeading.tsx'
import { BarcodeView } from '../barcodes/BarcodeView.tsx'
import { FORMAT_SPECS } from '../barcodes/formats.ts'
import { CARD_LIMITS, validateStoreName, type CardBarcode, type NewCardInput } from '../cards/card.ts'
import { ColorPicker } from '../cards/ColorPicker.tsx'

export interface CardDetailsFormProps {
  barcode: CardBarcode
  /** The image is original artwork the user chose to keep (not a fallback). */
  artwork?: boolean
  defaultColor: string
  focusOnMount: boolean
  onSave: (input: NewCardInput) => Promise<string | null>
}

export function CardDetailsForm({ barcode, artwork = false, defaultColor, focusOnMount, onSave }: CardDetailsFormProps) {
  const [storeName, setStoreName] = useState('')
  const [color, setColor] = useState(defaultColor)
  const [nameError, setNameError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)
  const nameId = useId()

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (saving) return
    const problem = validateStoreName(storeName)
    setNameError(problem)
    if (problem) {
      nameRef.current?.focus()
      return
    }
    setSaving(true)
    setSaveError(null)
    const message = await onSave({ storeName, color, barcode })
    // On success the parent leaves this screen.
    if (message) {
      setSaving(false)
      setSaveError(message)
    }
  }

  return (
    <form className="form details" onSubmit={submit} noValidate>
      <ViewHeading id="add-flow-heading" focusOnMount={focusOnMount}>
        Check and name
      </ViewHeading>

      <figure className="preview">
        <BarcodeView barcode={barcode} label="Captured barcode" />
        <figcaption className="preview__caption">
          {barcode.kind === 'generated' && (
            <>
              <span>{FORMAT_SPECS[barcode.format].label}</span>
              <span className="preview__value">{barcode.value}</span>
              <span>Redrawn from the barcode data. Check that it matches your card.</span>
            </>
          )}
          {barcode.kind === 'image' && artwork && (
            <>
              {barcode.detectedFormat && <span>{barcode.detectedFormat}</span>}
              {barcode.detectedValue !== undefined && <span className="preview__value">{barcode.detectedValue}</span>}
              <span>Original artwork, shown as-is at checkout. A redrawn code is usually easier for scanners to read.</span>
            </>
          )}
          {barcode.kind === 'image' && !artwork && (
            <span>
              Saved as an image because it couldn’t be redrawn
              {barcode.detectedFormat ? ` (${barcode.detectedFormat})` : ''}. Scanners may read it less reliably.
            </span>
          )}
        </figcaption>
      </figure>

      <div className="field">
        <label className="field__label" htmlFor={nameId}>
          Store name
        </label>
        <input
          ref={nameRef}
          id={nameId}
          className="field__control"
          value={storeName}
          maxLength={CARD_LIMITS.storeName}
          autoComplete="off"
          aria-invalid={nameError ? true : undefined}
          aria-describedby={nameError ? `${nameId}-error` : undefined}
          onChange={(event) => setStoreName(event.target.value)}
        />
        {nameError && (
          <p id={`${nameId}-error`} className="field__error" role="alert">
            {nameError}
          </p>
        )}
      </div>

      <ColorPicker name="new-card-color" value={color} onChange={setColor} />

      <div role="alert">{saveError && <p className="notice notice--error">{saveError}</p>}</div>

      <div className="form__actions">
        <button type="submit" className="button button--primary" aria-disabled={saving}>
          {saving ? 'Saving…' : 'Save card'}
        </button>
      </div>
    </form>
  )
}
