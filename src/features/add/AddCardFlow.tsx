/**
 * Add-card flow: capture a barcode once, then name and colour the card.
 *
 * Steps (plain state, no router):
 *   choose ─┬─ scan ───┐
 *           ├─ import ─┼─▶ details ─▶ save
 *           └─ manual ─┘
 *
 * - Every decoded or typed barcode passes the redraw round-trip check
 *   (CaptureServices.verify) before it can be saved as a generated barcode,
 *   so a card is never saved with a value the app can't redraw exactly.
 * - Only the import path can produce an image fallback, because only it has a
 *   user-chosen picture; camera frames are never kept.
 * - "Import image" opens the system picker directly from the choose screen,
 *   inside the same tap, because iOS only allows file pickers from a direct
 *   user gesture.
 *
 * - `footer` (v0.5.0) is shown under the capture choices on the first step
 *   only. App fills it with Backup, About and the copyright notice, so this
 *   flow does not depend on those features.
 *
 * This module (with ZXing, bwip-js and the cropper) is loaded lazily by App,
 * so the wallet and checkout screens don't pay for capture code.
 */
import { useRef, useState, type ReactNode } from 'react'
import { BackIcon, CameraIcon, ImageIcon, KeyboardIcon } from '../../components/icons.tsx'
import { ViewHeading } from '../../components/ViewHeading.tsx'
import type { BarcodeFormat } from '../barcodes/formats.ts'
import type { CardBarcode, NewCardInput } from '../cards/card.ts'
import { CameraScanner } from './CameraScanner.tsx'
import { defaultCaptureServices, type CaptureServices } from './captureServices.ts'
import { CardDetailsForm } from './CardDetailsForm.tsx'
import { ImageImport } from './ImageImport.tsx'
import { ManualEntry } from './ManualEntry.tsx'

export interface AddCardFlowProps {
  /** Suggested tile colour for the new card. */
  defaultColor: string
  onSave: (input: NewCardInput) => Promise<string | null>
  onCancel: () => void
  services?: CaptureServices
  /** Secondary content below the capture choices on the first step. */
  footer?: ReactNode
}

type Step =
  | { name: 'choose' }
  | { name: 'scan' }
  | { name: 'import'; file: File }
  | { name: 'manual'; initial?: { format: BarcodeFormat; value: string } }
  | { name: 'details'; barcode: CardBarcode; from: 'scan' | 'import' | 'manual'; artwork?: boolean }

export function AddCardFlow({ defaultColor, onSave, onCancel, services = defaultCaptureServices, footer }: AddCardFlowProps) {
  const [step, setStep] = useState<Step>({ name: 'choose' })
  // The flow is always entered by in-app navigation, so every step's heading
  // takes focus, including the first.
  const [moved, setMoved] = useState(true)
  const fileRef = useRef<HTMLInputElement>(null)

  const go = (next: Step) => {
    setMoved(true)
    setStep(next)
  }

  const back = () => {
    if (step.name === 'choose') onCancel()
    else if (step.name === 'details' && step.from === 'manual' && step.barcode.kind === 'generated') {
      // Return to the form with the typed value intact.
      go({ name: 'manual', initial: { format: step.barcode.format, value: step.barcode.value } })
    }
    else go({ name: 'choose' })
  }

  const toDetails = (barcode: CardBarcode, from: 'scan' | 'import' | 'manual', artwork = false) =>
    go({ name: 'details', barcode, from, ...(artwork ? { artwork } : {}) })

  return (
    <section className="add-flow" aria-labelledby="add-flow-heading">
      <button type="button" className="button button--ghost back-button" onClick={back}>
        <BackIcon />
        {step.name === 'choose' ? 'Cancel' : 'Back'}
      </button>

      {/* Owned here so the picker opens within the tap on "Import image". */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="visually-hidden"
        tabIndex={-1}
        aria-label="Choose image"
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) go({ name: 'import', file })
        }}
      />

      {step.name === 'choose' && (
        <>
          <ViewHeading id="add-flow-heading" className="visually-hidden" focusOnMount={moved}>
            Add a card
          </ViewHeading>
          <div className="capture-options">
            <button type="button" className="capture-option" onClick={() => go({ name: 'scan' })}>
              <CameraIcon />
              <span className="capture-option__title">Scan card</span>
              <span className="capture-option__hint">Point your camera at the barcode</span>
            </button>
            <button type="button" className="capture-option" onClick={() => fileRef.current?.click()}>
              <ImageIcon />
              <span className="capture-option__title">Import image</span>
              <span className="capture-option__hint">A screenshot or photo of the barcode</span>
            </button>
            <button type="button" className="capture-option" onClick={() => go({ name: 'manual' })}>
              <KeyboardIcon />
              <span className="capture-option__title">Enter manually</span>
              <span className="capture-option__hint">Type the number and choose the format</span>
            </button>
          </div>
          <p className="add-flow__privacy">Images and camera frames stay on this device.</p>
          {footer}
        </>
      )}

      {step.name === 'scan' && (
        <CameraScanner
          services={services}
          focusOnMount={moved}
          onCaptured={(barcode) => toDetails(barcode, 'scan')}
          onImport={() => fileRef.current?.click()}
          onManual={() => go({ name: 'manual' })}
        />
      )}

      {step.name === 'import' && (
        <ImageImport
          key={`${step.file.name}-${step.file.lastModified}-${step.file.size}`}
          file={step.file}
          services={services}
          focusOnMount={moved}
          onCaptured={(barcode, options) => toDetails(barcode, 'import', options?.artwork === true)}
          onChooseAnother={() => fileRef.current?.click()}
        />
      )}

      {step.name === 'manual' && (
        <ManualEntry
          services={services}
          focusOnMount={moved}
          initial={step.initial}
          onCaptured={(barcode) => toDetails(barcode, 'manual')}
        />
      )}

      {step.name === 'details' && (
        <CardDetailsForm
          barcode={step.barcode}
          artwork={step.artwork === true}
          defaultColor={defaultColor}
          focusOnMount={moved}
          onSave={onSave}
        />
      )}
    </section>
  )
}
