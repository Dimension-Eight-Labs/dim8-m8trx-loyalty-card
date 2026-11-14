/**
 * Stored-record schema handling: migrating older card records and reading
 * records defensively.
 *
 * Schema history (database `dim8-loyalty-card`, object store `cards`):
 * - v1 (app 0.2.0, Iteration 2): { id, storeName, cardNumber, notes,
 *   createdAt, updatedAt }. The card number was typed text with no symbology.
 * - v2 (app 0.3.0, Iteration 3): LoyaltyCard in src/features/cards/card.ts,
 *   with `schemaVersion: 2`, a tile `color`, and a `barcode` union.
 *
 * Migration policy: never delete or drop a record. A v1 card becomes a v2
 * card whose barcode is `{ kind: 'text', value: cardNumber }` (exact string,
 * leading zeros intact) because v1 never recorded a format and guessing one
 * could produce a scannable-looking but wrong barcode. Notes and timestamps
 * are kept. Records that are not recognizable v1 cards are left untouched.
 */
import { CARD_SCHEMA_VERSION, type CardBarcode, type LoyaltyCard } from '../features/cards/card.ts'
import { isBarcodeFormat } from '../features/barcodes/formats.ts'
import { colorForIndex } from '../features/cards/tileColors.ts'

type UnknownRecord = Record<string, unknown>

function isObject(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

/** True for an Iteration 2 (schema v1) card record. */
export function isV1Record(value: unknown): boolean {
  return (
    isObject(value) &&
    value.schemaVersion === undefined &&
    isString(value.id) &&
    isString(value.storeName) &&
    isString(value.cardNumber)
  )
}

/**
 * Converts a v1 record to v2. `index` (cursor position) picks a varied
 * default tile colour. Unknown extra fields are preserved by spreading.
 */
export function migrateV1Record(record: UnknownRecord, index: number): UnknownRecord {
  const { cardNumber, ...rest } = record
  return {
    ...rest,
    schemaVersion: CARD_SCHEMA_VERSION,
    color: colorForIndex(index),
    barcode: { kind: 'text', value: cardNumber as string } satisfies CardBarcode,
    notes: isString(record.notes) ? record.notes : '',
  }
}

function readBarcode(value: unknown): CardBarcode | null {
  if (!isObject(value)) return null
  switch (value.kind) {
    case 'generated':
      return isBarcodeFormat(value.format) && isString(value.value)
        ? { kind: 'generated', format: value.format, value: value.value }
        : null
    case 'image':
      if (!(value.image instanceof Blob)) return null
      return {
        kind: 'image',
        image: value.image,
        ...(isString(value.detectedValue) ? { detectedValue: value.detectedValue } : {}),
        ...(isString(value.detectedFormat) ? { detectedFormat: value.detectedFormat } : {}),
      }
    case 'text':
      return isString(value.value) ? { kind: 'text', value: value.value } : null
    default:
      return null
  }
}

/**
 * Returns the record as a LoyaltyCard, or null if it is not a readable v2
 * card (e.g. written by a newer app version). Unreadable records are skipped
 * in the wallet but never deleted.
 */
export function readCardRecord(value: unknown): LoyaltyCard | null {
  if (!isObject(value) || value.schemaVersion !== CARD_SCHEMA_VERSION) return null
  const { id, storeName, color, createdAt, updatedAt, notes } = value
  if (!isString(id) || !isString(storeName) || !isString(color) || !isString(createdAt) || !isString(updatedAt)) {
    return null
  }
  const barcode = readBarcode(value.barcode)
  if (!barcode) return null
  return {
    id,
    schemaVersion: CARD_SCHEMA_VERSION,
    storeName,
    color,
    barcode,
    ...(isString(notes) && notes !== '' ? { notes } : {}),
    createdAt,
    updatedAt,
  }
}
