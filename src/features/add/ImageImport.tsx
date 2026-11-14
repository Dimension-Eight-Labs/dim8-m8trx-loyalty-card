/**
 * Import a barcode from an existing screenshot or photo.
 *
 * 1. Load the chosen file locally and try to decode the whole image, using a
 *    bounded cascade of temporary views (see decodeCascade.ts).
 * 2. If nothing usable is found, show a cropper (drag to pan, pinch / slider
 *    to zoom, Wide or Square frame) and let the user retry on the crop.
 * 3. If the crop still can't be decoded and redrawn, the user may save the
 *    cropped image as the card's barcode — clearly labelled as a fallback.
 *
 * The object URL is released on unmount. Nothing leaves the device.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import Cropper, { type Area } from 'react-easy-crop'
import { ViewHeading } from '../../components/ViewHeading.tsx'
import type { CardBarcode } from '../cards/card.ts'
import { outcomeFromDecode } from './captureOutcome.ts'
import type { CaptureServices, LoadedImage } from './captureServices.ts'

export interface ImageImportProps {
  file: File
  services: CaptureServices
  focusOnMount: boolean
  onCaptured: (barcode: CardBarcode) => void
  onChooseAnother: () => void
}

type State =
  | { name: 'loading' }
  | { name: 'load-failed'; message: string }
  | { name: 'crop'; message: string; detected?: { formatLabel: string; value: string } }

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
        if (outcome.ok) latest.current.onCaptured(outcome.barcode)
        else
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
      onCaptured(outcome.barcode)
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
      onCaptured({
        kind: 'image',
        image: blob,
        ...(state.detected ? { detectedFormat: state.detected.formatLabel, detectedValue: state.detected.value } : {}),
      })
    } catch (error) {
      setBusy(false)
      setState({ ...state, message: error instanceof Error ? error.message : 'Couldn’t crop the image.' })
    }
  }

  return (
    <div className="import">
      <ViewHeading id="add-flow-heading" focusOnMount={focusOnMount}>
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
          <div className="button-row">
            <button type="button" className="button button--primary" onClick={retry} aria-disabled={busy}>
              {busy ? 'Working…' : 'Try again'}
            </button>
            <button type="button" className="button button--secondary" onClick={saveAsImage} aria-disabled={busy}>
              Save cropped image
            </button>
          </div>
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
