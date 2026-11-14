/**
 * Manual barcode entry: exact value + explicit format, validated live, with a
 * generated preview before continuing.
 *
 * The value is never trimmed, upper-cased, or padded: what is typed is what is
 * encoded. Validation errors appear after the field is left or Continue is
 * pressed, not on every keystroke. Continue also runs the redraw round-trip
 * check, so an un-drawable value cannot be saved.
 *
 * Code 128 is the default because it is the most common loyalty-card format
 * and accepts any ASCII text.
 */
import { useId, useRef, useState, type FormEvent } from 'react'
import { ViewHeading } from '../../components/ViewHeading.tsx'
import { BarcodeView } from '../barcodes/BarcodeView.tsx'
import { BARCODE_FORMATS, FORMAT_SPECS, validateBarcodeValue, type BarcodeFormat } from '../barcodes/formats.ts'
import type { CardBarcode } from '../cards/card.ts'
import type { CaptureServices } from './captureServices.ts'

export interface ManualEntryProps {
  services: CaptureServices
  focusOnMount: boolean
  initial?: { format: BarcodeFormat; value: string }
  onCaptured: (barcode: CardBarcode) => void
}

const NUMERIC_FORMATS: readonly BarcodeFormat[] = ['ean13', 'upca', 'ean8']

export function ManualEntry({ services, focusOnMount, initial, onCaptured }: ManualEntryProps) {
  const [format, setFormat] = useState<BarcodeFormat>(initial?.format ?? 'code128')
  const [value, setValue] = useState(initial?.value ?? '')
  const [touched, setTouched] = useState(initial !== undefined)
  const [verifyError, setVerifyError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const formatId = useId()
  const valueId = useId()

  const validation = validateBarcodeValue(format, value)
  const error = verifyError ?? (touched ? validation : null)
  const spec = FORMAT_SPECS[format]

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setTouched(true)
    if (validation) {
      inputRef.current?.focus()
      return
    }
    const check = services.verify(format, value)
    if (!check.ok) {
      setVerifyError(check.reason)
      inputRef.current?.focus()
      return
    }
    onCaptured({ kind: 'generated', format, value })
  }

  return (
    <form className="form manual" onSubmit={submit} noValidate>
      <ViewHeading id="add-flow-heading" focusOnMount={focusOnMount}>
        Enter manually
      </ViewHeading>

      <div className="field">
        <label className="field__label" htmlFor={formatId}>
          Barcode format
        </label>
        <select
          id={formatId}
          className="field__control"
          value={format}
          onChange={(event) => {
            setFormat(event.target.value as BarcodeFormat)
            setVerifyError(null)
          }}
        >
          {BARCODE_FORMATS.map((option) => (
            <option key={option} value={option}>
              {FORMAT_SPECS[option].label}
            </option>
          ))}
        </select>
        <p className="field__hint">{spec.hint}</p>
      </div>

      <div className="field">
        <label className="field__label" htmlFor={valueId}>
          Barcode value
        </label>
        <input
          ref={inputRef}
          id={valueId}
          className="field__control field__control--mono"
          value={value}
          maxLength={spec.maxLength}
          inputMode={NUMERIC_FORMATS.includes(format) ? 'numeric' : 'text'}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${valueId}-error` : undefined}
          onChange={(event) => {
            setValue(event.target.value)
            setVerifyError(null)
          }}
          onBlur={() => setTouched(true)}
        />
        {error && (
          <p id={`${valueId}-error`} className="field__error" role="alert">
            {error}
          </p>
        )}
      </div>

      {!validation && (
        <div className="preview" aria-label="Barcode preview">
          <BarcodeView barcode={{ kind: 'generated', format, value }} label="Preview" />
        </div>
      )}

      <div className="form__actions">
        <button type="submit" className="button button--primary">
          Continue
        </button>
      </div>
    </form>
  )
}
