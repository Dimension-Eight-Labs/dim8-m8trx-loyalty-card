/**
 * Card domain model: what a stored loyalty card is, what a user supplies to
 * create one, and the validation rules shared by the UI and persistence.
 *
 * Technology-neutral on purpose: nothing here knows about React or IndexedDB,
 * so storage adapters and UI can change independently.
 *
 * Barcode data is a discriminated union, because the app keeps a card even
 * when it cannot redraw it:
 * - `generated`: an exact value plus its symbology, redrawn as SVG at checkout.
 * - `image`: a cropped picture of the barcode, for codes that could not be
 *   decoded or redrawn reliably. Any value/format that was detected is kept
 *   alongside for reference.
 * - `text`: a number with no known symbology. Only produced by migrating
 *   Iteration 2 cards, which stored a typed card number without a format. The
 *   app never guesses a format for these.
 */
import { isBarcodeFormat, validateBarcodeValue, type BarcodeFormat } from '../barcodes/formats.ts'
import { isTileColorId } from './tileColors.ts'

/** Current record schema; stored on each card to make future migrations explicit. */
export const CARD_SCHEMA_VERSION = 2

export type CardBarcode =
  | { kind: 'generated'; format: BarcodeFormat; value: string }
  | {
      kind: 'image'
      /** Cropped barcode image, stored as a Blob (not base64) to keep it compact. */
      image: Blob
      /** Value ZXing read, if any (kept for reference; never used to redraw). */
      detectedValue?: string
      /** Human-readable symbology name ZXing reported, if any. */
      detectedFormat?: string
    }
  | { kind: 'text'; value: string }

/** A saved loyalty or membership card. */
export interface LoyaltyCard {
  /** Stable, opaque identifier generated on creation. */
  id: string
  schemaVersion: typeof CARD_SCHEMA_VERSION
  /** Store or organization name shown on the tile. */
  storeName: string
  /** Palette id from tileColors.ts. */
  color: string
  barcode: CardBarcode
  /**
   * Notes carried over from Iteration 2 records. No longer shown or editable,
   * but kept so migration never discards data the user typed.
   */
  notes?: string
  /** ISO 8601 timestamps. Internal only (ordering, diagnostics); never shown. */
  createdAt: string
  updatedAt: string
}

/** Everything needed to create a card. */
export interface NewCardInput {
  storeName: string
  color: string
  barcode: CardBarcode
}

/** Editable fields after creation. Barcode data is deliberately not editable. */
export interface CardChanges {
  storeName?: string
  color?: string
}

export const CARD_LIMITS = {
  /** Same limit as Iteration 2, so migrated names stay valid when renamed. */
  storeName: 80,
  /** Cropped fallback images are downscaled before saving; this is a safety cap. */
  imageBytes: 4 * 1024 * 1024,
} as const

/** Trims and validates a store name. Returns an error message or null. */
export function validateStoreName(name: string): string | null {
  const value = name.trim()
  if (value === '') return 'Enter the store name.'
  if (value.length > CARD_LIMITS.storeName) return `Keep the name to ${CARD_LIMITS.storeName} characters or fewer.`
  return null
}

export function validateColor(color: string): string | null {
  return isTileColorId(color) ? null : 'Choose a tile colour.'
}

/** Validates barcode data exactly as given (no trimming). */
export function validateBarcode(barcode: CardBarcode): string | null {
  switch (barcode.kind) {
    case 'generated':
      if (!isBarcodeFormat(barcode.format)) return 'Unsupported barcode format.'
      return validateBarcodeValue(barcode.format, barcode.value)
    case 'image':
      if (!(barcode.image instanceof Blob) || barcode.image.size === 0) return 'The barcode image is missing.'
      if (barcode.image.size > CARD_LIMITS.imageBytes) return 'The barcode image is too large.'
      return null
    case 'text':
      return barcode.value.length > 0 ? null : 'The card number is missing.'
  }
}

/** First validation error in a new card, or null when it can be saved. */
export function validateNewCard(input: NewCardInput): string | null {
  return validateStoreName(input.storeName) ?? validateColor(input.color) ?? validateBarcode(input.barcode)
}

/**
 * Wallet order: oldest first, so a card keeps its place when renamed or
 * recoloured and new cards appear at the end (muscle memory at checkout).
 */
export function compareByCreated(a: LoyaltyCard, b: LoyaltyCard): number {
  if (a.createdAt === b.createdAt) return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  return a.createdAt < b.createdAt ? -1 : 1
}
