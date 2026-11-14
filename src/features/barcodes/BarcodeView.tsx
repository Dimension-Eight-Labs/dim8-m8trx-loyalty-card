/**
 * Displays a card's barcode data in the best available form:
 * - `generated`: freshly drawn SVG (via an <img> data URL; never injected
 *   markup), with the format's quiet zone built into the image.
 * - `image`: the saved cropped picture (object URL, revoked on unmount).
 * - `text`: the number in large monospace type, for migrated cards with no
 *   known symbology. No barcode is drawn because guessing a format could show
 *   a confident-looking but wrong code.
 *
 * Rendering failures show a short explanation rather than a broken image.
 */
import { useEffect, useMemo, useState } from 'react'
import type { CardBarcode } from '../cards/card.ts'
import { FORMAT_SPECS } from './formats.ts'
import { renderBarcodeSvg, svgToDataUrl } from './render.ts'

export interface BarcodeViewProps {
  barcode: CardBarcode
  /** Used in the image's accessible name, e.g. "Corner Coffee barcode". */
  label: string
}

export function BarcodeView({ barcode, label }: BarcodeViewProps) {
  switch (barcode.kind) {
    case 'generated':
      return <GeneratedBarcode format={barcode.format} value={barcode.value} label={label} />
    case 'image':
      return <ImageBarcode image={barcode.image} label={label} />
    case 'text':
      return (
        <div className="barcode barcode--text">
          <p className="barcode__number">{barcode.value}</p>
          <p className="barcode__note">No barcode saved for this card. Re-add it by scanning to show a barcode.</p>
        </div>
      )
  }
}

function GeneratedBarcode({ format, value, label }: { format: keyof typeof FORMAT_SPECS; value: string; label: string }) {
  const rendered = useMemo(() => {
    try {
      return { ok: true as const, url: svgToDataUrl(renderBarcodeSvg(format, value)) }
    } catch (error) {
      return { ok: false as const, message: error instanceof Error ? error.message : 'This barcode can’t be drawn.' }
    }
  }, [format, value])

  if (!rendered.ok) {
    return (
      <div className="barcode barcode--text">
        <p className="barcode__number">{value}</p>
        <p className="barcode__note">{rendered.message}</p>
      </div>
    )
  }
  const spec = FORMAT_SPECS[format]
  return (
    <div className={`barcode barcode--${spec.dimension}`}>
      <img className="barcode__image" src={rendered.url} alt={`${label} (${spec.label})`} draggable={false} />
    </div>
  )
}

function ImageBarcode({ image, label }: { image: Blob; label: string }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    // The object URL is an external resource that must be created and revoked
    // in step with this effect (a render-time useMemo would leave a revoked URL
    // behind after StrictMode's mount/unmount/mount cycle).
    const objectUrl = URL.createObjectURL(image)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [image])
  return (
    <div className="barcode barcode--photo">
      {url && <img className="barcode__image" src={url} alt={`${label} (saved image)`} draggable={false} />}
    </div>
  )
}
