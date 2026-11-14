/**
 * Miniature card shown on a wallet tile: a small white card with accent bands
 * (echoing the checkout screen) and a decorative motif of the card's barcode
 * type, so cards are recognisable at a glance rather than plain squares.
 *
 * Decorative only — it is `aria-hidden`, and the tile's accessible name stays
 * the store name. The motifs are deliberately NOT real barcodes:
 * - They never encode the card's value (the home screen shows no card data,
 *   and a scannable code on a small tile could be read by mistake).
 * - Their pattern is derived from the card id, so each card looks stable and
 *   a little different without revealing anything about its number.
 *
 * Variants (exposed as `data-preview` for tests and styling):
 * - `linear`  — Code 128/39, EAN/UPC: a strip of thin bars.
 * - `stacked` — PDF417: short rows of bars.
 * - `qr`      — QR: a module grid with the three finder squares.
 * - `matrix`  — Data Matrix/Aztec: a module grid without QR finders.
 * - `image`   — saved artwork (cropped image), shown with object-fit: contain.
 *               Falls back to `matrix`/`linear` styling until the image loads,
 *               or when the browser cannot create object URLs.
 * - `text`    — migrated number-only cards: a few neutral "digit" dashes.
 *
 * Kept free of bwip-js and ZXing so the wallet bundle stays small; only the
 * format registry (plain data) is imported.
 */
import { useEffect, useMemo, useState } from 'react'
import type { LoyaltyCard } from '../cards/card.ts'
import { previewVariant, seededRandom } from './previewMotif.ts'

const INK = '#1f2329'

/** Bars across a 64×24 box: widths 1–3 units, gaps 1–2, like a real 1D code. */
function LinearMotif({ seed, rows = 1 }: { seed: string; rows?: number }) {
  const rects = useMemo(() => {
    const random = seededRandom(seed)
    const out: Array<{ x: number; y: number; w: number; h: number }> = []
    const rowHeight = 24 / rows
    for (let r = 0; r < rows; r++) {
      let x = 2
      while (x < 62) {
        const w = 1 + Math.floor(random() * 3)
        out.push({ x, y: r * rowHeight + (rows > 1 ? 0.6 : 0), w: Math.min(w, 62 - x), h: rowHeight - (rows > 1 ? 1.2 : 0) })
        x += w + 1 + Math.floor(random() * 2)
      }
    }
    return out
  }, [seed, rows])
  return (
    <svg className="card-preview__motif card-preview__motif--wide" viewBox="0 0 64 24" preserveAspectRatio="xMidYMid meet" focusable="false">
      {rects.map((r, i) => (
        <rect key={i} x={r.x} y={r.y} width={r.w} height={r.h} fill={INK} />
      ))}
    </svg>
  )
}

const GRID = 13
const FINDERS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [GRID - 3, 0],
  [0, GRID - 3],
]

/** Module grid; with `finders`, the three QR corner squares are drawn too. */
function MatrixMotif({ seed, finders }: { seed: string; finders: boolean }) {
  const modules = useMemo(() => {
    const random = seededRandom(seed)
    const inFinder = (x: number, y: number) => finders && ((x < 4 && y < 4) || (x >= GRID - 4 && y < 4) || (x < 4 && y >= GRID - 4))
    const out: Array<[number, number]> = []
    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        if (inFinder(x, y)) continue
        // Data Matrix-style solid L border when there are no finders.
        if (!finders && (x === 0 || y === GRID - 1)) out.push([x, y])
        else if (random() < 0.45) out.push([x, y])
      }
    }
    return out
  }, [seed, finders])
  return (
    <svg className="card-preview__motif card-preview__motif--square" viewBox={`-0.5 -0.5 ${GRID + 1} ${GRID + 1}`} focusable="false">
      {modules.map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={INK} />
      ))}
      {finders &&
        FINDERS.map(([x, y]) => (
          // Finder square: dark ring, white gap, dark centre (a 3-module miniature of QR's 7-module finder).
          <g key={`f${x}-${y}`} data-finder="">
            <rect x={x} y={y} width={3} height={3} fill={INK} />
            <rect x={x + 0.5} y={y + 0.5} width={2} height={2} fill="#ffffff" />
            <rect x={x + 1} y={y + 1} width={1} height={1} fill={INK} />
          </g>
        ))}
    </svg>
  )
}

function TextMotif() {
  return (
    <svg className="card-preview__motif card-preview__motif--wide" viewBox="0 0 64 24" focusable="false">
      {[0, 1, 2, 3].map((group) => (
        <rect key={group} x={4 + group * 15} y={10} width={11} height={4} rx={2} fill={INK} opacity={0.55} />
      ))}
    </svg>
  )
}

/** Object URL for a stored image, created and revoked with the component. */
function useObjectUrl(blob: Blob | null): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    // jsdom and very old browsers lack createObjectURL; the motif fallback shows instead.
    if (!blob || typeof URL.createObjectURL !== 'function') return
    const objectUrl = URL.createObjectURL(blob)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUrl(objectUrl)
    return () => {
      URL.revokeObjectURL(objectUrl)
      setUrl(null)
    }
  }, [blob])
  return url
}

export function CardPreview({ card }: { card: LoyaltyCard }) {
  const variant = previewVariant(card.barcode)
  const imageUrl = useObjectUrl(card.barcode.kind === 'image' ? card.barcode.image : null)

  let motif
  if (variant === 'image') {
    // Saved artwork is the most recognisable preview; until it loads, a
    // neutral grid stands in (artwork is usually a 2D code).
    motif = imageUrl ? <img className="card-preview__image" src={imageUrl} alt="" draggable={false} /> : <MatrixMotif seed={card.id} finders={false} />
  } else if (variant === 'linear') motif = <LinearMotif seed={card.id} />
  else if (variant === 'stacked') motif = <LinearMotif seed={card.id} rows={4} />
  else if (variant === 'qr') motif = <MatrixMotif seed={card.id} finders />
  else if (variant === 'matrix') motif = <MatrixMotif seed={card.id} finders={false} />
  else motif = <TextMotif />

  return (
    <span className="card-preview" data-preview={variant} aria-hidden="true">
      <span className="card-preview__band" />
      <span className="card-preview__body">{motif}</span>
      <span className="card-preview__band card-preview__band--bottom" />
    </span>
  )
}
