/**
 * Chooses the checkout card-face shape for a card's barcode (v0.4.2).
 *
 * Why this exists: a single credit-card-shaped face suits linear barcodes but
 * leaves square symbols (QR and friends) height-limited and small. Checkout
 * therefore asks this module which shape to use, keyed on the barcode's
 * *known* symbology only:
 *
 * - `square`  — QR, Data Matrix and Aztec, whether redrawn (`generated`) or
 *   saved as the code's own artwork (`image` with that `detectedFormat`).
 *   These get a near-square face so the symbol can use most of the height.
 * - `stacked` — PDF417. Two-dimensional but wide, so it must never be
 *   treated as QR; it keeps the slightly taller card it had in v0.4.1.
 * - `card`    — everything else: linear codes, imported images whose format
 *   is unknown or not square, and text-only cards. The compact
 *   credit-card face.
 *
 * Deliberately NOT inferred from an image's pixel dimensions: a square crop
 * can hold a PDF417, a linear code or a logo, and guessing would present it
 * wrongly. Unknown stays `card`.
 *
 * Pure and framework-free so the rule is unit-testable on its own.
 */
import type { CardBarcode } from '../cards/card.ts'
import { FORMAT_SPECS, type BarcodeFormat } from './formats.ts'

export type CheckoutPresentation = 'square' | 'stacked' | 'card'

/** Square-module symbologies whose symbols are (normally) square. */
const SQUARE_FORMATS: ReadonlySet<BarcodeFormat> = new Set(['qrcode', 'datamatrix', 'azteccode'])

/** Presentation for a known, supported symbology. */
function presentationForFormat(format: BarcodeFormat): CheckoutPresentation {
  if (SQUARE_FORMATS.has(format)) return 'square'
  if (format === 'pdf417') return 'stacked'
  return 'card'
}

/**
 * Maps the label stored on imported images (`detectedFormat`, the
 * FORMAT_SPECS label such as "QR code") back to a format. Labels for
 * symbologies the app cannot redraw (e.g. "Codabar") map to nothing.
 */
function formatFromLabel(label: string | undefined): BarcodeFormat | undefined {
  if (!label) return undefined
  const wanted = label.trim().toLowerCase()
  return (Object.keys(FORMAT_SPECS) as BarcodeFormat[]).find((format) => FORMAT_SPECS[format].label.toLowerCase() === wanted)
}

/** The checkout face shape for a card's barcode. */
export function checkoutPresentation(barcode: CardBarcode): CheckoutPresentation {
  switch (barcode.kind) {
    case 'generated':
      return presentationForFormat(barcode.format)
    case 'image': {
      const format = formatFromLabel(barcode.detectedFormat)
      return format ? presentationForFormat(format) : 'card'
    }
    case 'text':
      return 'card'
  }
}
