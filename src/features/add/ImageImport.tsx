/**
 * Import a barcode from an existing screenshot or photo.
 *
 * 1. Load the chosen file locally and try to decode the whole image, using a
 *    bounded cascade of temporary views (see decodeCascade.ts).
 * 2. If nothing usable is found, show a cropper (drag to pan, pinch / slider
 *    to zoom, Wide or Square frame) and let the user retry on the crop.
 * 3. If the crop still can't be decoded and redrawn, the user may save the
 *    cropped image as the card's barcode — clearly labelled as a fallback.
 * 4. When a QR code decodes, the user chooses between the redrawn QR code
 *    (the default, usually the most reliable at checkout) and keeping the
 *    original artwork (e.g. a branded QR with a logo or styled modules). Keeping
 *    it reuses the same cropper and stores the crop as an `image` barcode with
 *    the detected format and exact value kept alongside for reference.
 *
 * The object URL is released on unmount. Nothing leaves the device.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import Cropper, { type Area } from 'react-easy-crop'
import { ViewHeading } from '../../components/ViewHeading.tsx'
import { FORMAT_SPECS } from '../barcodes/formats.ts'
import type { CardBarcode } from '../cards/card.ts'
import { outcomeFromDecode } from './captureOutcome.ts'
import type { CaptureServices, LoadedImage } from './captureServices.ts'

export interface ImageImportProps {
  file: File
  services: CaptureServices
  focusOnMount: boolean
  /** `artwork` is true when the user chose to keep a decoded code's original image. */
  onCaptured: (barcode: CardBarcode, options?: { artwork?: boolean }) => void
  onChooseAnother: () => void
}

type GeneratedBarcode = Extract<CardBarcode, { kind: 'generated' }>

type State =
  | { name: 'loading' }
  | { name: 'load-failed'; message: string }
  /** A QR code decoded and redraws exactly: redrawn code or original artwork? */
  | { name: 'decoded-qr'; barcode: GeneratedBarcode }
  /**
   * Cropper. `artwork` is set when cropping a successfully decoded QR code to
   * keep its original look (no retry needed; the decoded value is known).
   */
  | { name: 'crop'; message: string; detected?: { formatLabel: string; value: string }; artwork?: GeneratedBarcode }

/** Only QR codes offer the artwork choice: custom-styled QR artwork is common, styled 1D bars are not. */
function offersArtwork(barcode: CardBarcode): barcode is GeneratedBarcode {
  return barcode.kind === 'generated' && barcode.format === 'qrcode'
}

/**
 * Extra explanation when the browser alters canvas pixel reads (see
 * canvasProbe.ts): in that case no amount of cropping will help.
 */
function readbackHint(services: CaptureServices): string {
  return services.canvasReadback?.() === 'altered'
    ? ' This browser seems to be altering image data for privacy (for example Brave Shields), which can stop barcodes from being read; try turning that protection off for this site.'
    : ''
}

/** Crop frames: wide suits 1D barcodes, square suits QR / Data Matrix / Aztec. */
const FRAMES = { wide: 2.5, square: 1 } as const

export function ImageImport({ file, services, focusOnMount, onCaptured, onChooseAnother }: ImageImportProps) {
  const [state, setState] = useState<State>({ name: 'loading' })
  const [image, setImage] = useState<LoadedImage | null>(null)
  const [busy, setBusy] = useState(false)
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [frame, setFrame] = useState<keyof typeof FRAMES>('wide')
  const area = useRef<Area | null>(null)
  const latest = useRef({ services, onCaptured })
  useEffect(() => {
    latest.current = { services, onCaptured }
  })

  // Load and auto-decode once per file.
  useEffect(() => {
    let cancelled = false
    let loaded: LoadedImage | null = null
    const { services: svc } = latest.current
    svc
      .loadImage(file)
      .then(async (result) => {
        loaded = result
        if (cancelled) return result.release()
        setImage(result)
        const outcome = outcomeFromDecode(await svc.decodeImage(result), svc.verify)
        if (cancelled) return
        if (outcome.ok) {
          if (offersArtwork(outcome.barcode)) setState({ name: 'decoded-qr', barcode: outcome.barcode })
          else latest.current.onCaptured(outcome.barcode)
        } else
          setState({
            name: 'crop',
            message:
              outcome.detected !== undefined
                ? `${outcome.message} You can save the cropped image instead.`
                : `No barcode was found. Crop and zoom to the barcode, then try again.${readbackHint(svc)}`,
            detected: outcome.detected,
          })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setState({ name: 'load-failed', message: error instanceof Error ? error.message : 'That image couldn’t be opened.' })
      })
    return () => {
      cancelled = true
      loaded?.release()
    }
  }, [file])

  const onCropComplete = useCallback((_: Area, pixels: Area) => {
    area.current = pixels
  }, [])

  // Falls back to the whole image until the cropper reports a usable area
  // (it reports NaN sizes before the image has laid out).
  const currentArea = () => {
    const pixels = area.current
    if (pixels && [pixels.x, pixels.y, pixels.width, pixels.height].every(Number.isFinite) && pixels.width > 0 && pixels.height > 0) {
      return pixels
    }
    return image ? { x: 0, y: 0, width: image.width, height: image.height } : null
  }

  const retry = async () => {
    const region = currentArea()
    if (!image || !region || busy) return
    setBusy(true)
    let outcome
    try {
      outcome = outcomeFromDecode(await services.decodeImage(image, region), services.verify)
    } catch {
      // A decode failure must not leave the buttons stuck in "Working…".
      outcome = outcomeFromDecode({ status: 'not-found' }, services.verify)
    } finally {
      setBusy(false)
    }
    if (outcome.ok) {
      if (offersArtwork(outcome.barcode)) setState({ name: 'decoded-qr', barcode: outcome.barcode })
      else onCaptured(outcome.barcode)
      return
    }
    setState({
      name: 'crop',
      message: outcome.detected
        ? `${outcome.message} You can save the cropped image instead.`
        : `Still no barcode found. Adjust the crop and try again, or save the cropped image.${readbackHint(services)}`,
      detected: outcome.detected,
    })
  }

  const saveAsImage = async () => {
    const region = currentArea()
    if (!image || !region || busy || state.name !== 'crop') return
    setBusy(true)
    try {
      const blob = await services.cropImage(image, region)
      onCaptured(
        {
          kind: 'image',
          image: blob,
          ...(state.detected ? { detectedFormat: state.detected.formatLabel, detectedValue: state.detected.value } : {}),
        },
        state.artwork ? { artwork: true } : undefined,
      )
    } catch (error) {
      setBusy(false)
      setState({ ...state, message: error instanceof Error ? error.message : 'Couldn’t crop the image.' })
    }
  }

  const keepArtwork = (barcode: GeneratedBarcode) => {
    setFrame('square')
    setState({
      name: 'crop',
      message: 'Crop to the QR code, keeping some white space around it, then save the image.',
      detected: { formatLabel: FORMAT_SPECS[barcode.format].label, value: barcode.value },
      artwork: barcode,
    })
  }

  return (
    <div className="import">
      <ViewHeading id="add-flow-heading" className="visually-hidden" focusOnMount={focusOnMount}>
        Import image
      </ViewHeading>

      {state.name === 'loading' && (
        <p className="import__status" role="status">
          Looking for a barcode…
        </p>
      )}

      {state.name === 'load-failed' && (
        <>
          <p className="notice notice--error" role="alert">
            {state.message}
          </p>
          <button type="button" className="button button--secondary" onClick={onChooseAnother}>
            Choose another image
          </button>
        </>
      )}

      {state.name === 'decoded-qr' && (
        <>
          <p className="notice" role="status">
            Found a QR code.
          </p>
          <p className="import__value">{state.barcode.value}</p>
          <p className="field__hint">
            A redrawn QR code is usually the most reliable at checkout. Keep the original artwork if you prefer the card’s own
            design (for example a logo inside the code).
          </p>
          <div className="button-row">
            <button type="button" className="button button--primary" onClick={() => onCaptured(state.barcode)}>
              Use redrawn QR code
            </button>
            <button type="button" className="button button--secondary" onClick={() => keepArtwork(state.barcode)}>
              Keep original artwork
            </button>
          </div>
        </>
      )}

      {state.name === 'crop' && image && (
        <>
          <p className="notice" role="alert">
            {state.message}
          </p>
          <div className="cropper">
            <Cropper
              image={image.url}
              crop={crop}
              zoom={zoom}
              minZoom={1}
              maxZoom={8}
              aspect={FRAMES[frame]}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={onCropComplete}
              objectFit="contain"
              showGrid={false}
              mediaProps={{ alt: 'Imported image' }}
            />
          </div>
          <div className="crop-controls">
            <label className="crop-controls__zoom">
              <span className="field__label">Zoom</span>
              <input
                type="range"
                min={1}
                max={8}
                step={0.1}
                value={zoom}
                onChange={(event) => setZoom(Number(event.target.value))}
              />
            </label>
            <div className="segmented" role="group" aria-label="Crop frame">
              {(Object.keys(FRAMES) as Array<keyof typeof FRAMES>).map((name) => (
                <button
                  key={name}
                  type="button"
                  className="segmented__option"
                  aria-pressed={frame === name}
                  onClick={() => setFrame(name)}
                >
                  {name === 'wide' ? 'Wide' : 'Square'}
                </button>
              ))}
            </div>
          </div>
          {state.artwork ? (
            <div className="button-row">
              <button type="button" className="button button--primary" onClick={saveAsImage} aria-disabled={busy}>
                {busy ? 'Working…' : 'Save cropped image'}
              </button>
              <button type="button" className="button button--secondary" onClick={() => state.artwork && onCaptured(state.artwork)}>
                Use redrawn QR code
              </button>
            </div>
          ) : (
            <div className="button-row">
              <button type="button" className="button button--primary" onClick={retry} aria-disabled={busy}>
                {busy ? 'Working…' : 'Try again'}
              </button>
              <button type="button" className="button button--secondary" onClick={saveAsImage} aria-disabled={busy}>
                Save cropped image
              </button>
            </div>
          )}
          <p className="field__hint">
            A saved image is shown as-is at checkout. A redrawn barcode is usually easier for scanners to read.
          </p>
          <button type="button" className="button button--ghost" onClick={onChooseAnother}>
            Choose another image
          </button>
        </>
      )}
    </div>
  )
}
