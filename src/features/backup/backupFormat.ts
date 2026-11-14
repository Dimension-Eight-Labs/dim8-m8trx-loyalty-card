/**
 * M8TRX backup file format, version 1 (`.m8trx`).
 *
 * A backup is one UTF-8 JSON document, chosen over a ZIP archive because it
 * needs no archive dependency, has no file paths inside it (so no path
 * traversal), and cannot be a decompression bomb, while still being a single
 * portable file the user can keep in Files / iCloud Drive or anywhere else.
 *
 *   {
 *     "format": "m8trx-backup",          // identifies the file type
 *     "version": 1,                      // this layout; bumped on breaking change
 *     "exportedAt": "2026-11-14T18:00:00.000Z",
 *     "app": { "name": "M8TRX", "version": "0.5.0" },   // informational only
 *     "order": ["<card id>", ...],       // wallet order; names every card once
 *     "cards": [ {
 *       "id": "...", "schemaVersion": 2, "storeName": "...", "color": "teal",
 *       "notes": "...",                  // optional (migrated Iteration 2 notes)
 *       "createdAt": "<ISO 8601>", "updatedAt": "<ISO 8601>",
 *       "barcode":
 *           { "kind": "generated", "format": "code128", "value": "..." }
 *         | { "kind": "text", "value": "..." }
 *         | { "kind": "image", "mimeType": "image/png", "byteLength": 1234,
 *             "data": "<base64 of the stored image bytes>",
 *             "detectedValue": "...", "detectedFormat": "QR code" }  // optional
 *     } ]
 *   }
 *
 * Fidelity: card records are copied field for field. Barcode values are
 * never trimmed. Stored artwork (imported images, kept QR artwork) is
 * base64 of the exact stored bytes: never decoded, redrawn, resized or
 * recompressed. Generated barcodes are stored as format + value and redrawn
 * by the app, as they are in the wallet itself.
 *
 * Restore treats the file as untrusted input. `parseBackup` validates the
 * whole document (size, structure, every field, image signatures, the order
 * permutation) and either returns every card or throws a BackupError; it
 * never returns a partial result. Limits bound memory use (BACKUP_LIMITS).
 *
 * Duplicate policy (`planRestore`): existing cards are never overwritten or
 * removed. A backup card is
 * - a duplicate when the wallet already holds a card with the same barcode
 *   identity (same format + value, same detected image format + value, or
 *   identical image bytes), whatever its ID; or when the same ID holds the
 *   same barcode;
 * - a conflict when its ID is already used by a card with a different
 *   barcode;
 * - otherwise importable. Importable cards are appended after the existing
 *   cards in their backup order. Duplicates and conflicts are skipped.
 *
 * Technology-neutral: no React, IndexedDB or file-picker code here.
 */
import { isBarcodeFormat } from '../barcodes/formats.ts'
import {
  CARD_LIMITS,
  CARD_SCHEMA_VERSION,
  validateBarcode,
  validateColor,
  validateStoreName,
  type CardBarcode,
  type LoyaltyCard,
} from '../cards/card.ts'

export const BACKUP_FORMAT_ID = 'm8trx-backup'
export const BACKUP_FORMAT_VERSION = 1
export const BACKUP_FILE_EXTENSION = '.m8trx'
/** Shared/downloaded as JSON so any tool can open it. */
export const BACKUP_MIME_TYPE = 'application/json'

const MIB = 1024 * 1024

/**
 * Safety limits for reading a backup. Generous for real wallets (a card's
 * stored image is capped at CARD_LIMITS.imageBytes, normally far smaller)
 * while keeping a hostile file from exhausting a phone's memory.
 */
export const BACKUP_LIMITS = {
  /** Checked before the file is read at all. Base64 inflates images by 4/3. */
  fileBytes: 64 * MIB,
  cards: 1000,
  imageBytes: CARD_LIMITS.imageBytes,
  /** Sum of all decoded image bytes. */
  totalImageBytes: 40 * MIB,
  idLength: 128,
  notesLength: 10_000,
  valueLength: 4096,
  detectedLength: 4096,
  timestampLength: 64,
} as const

export type BackupLimits = { readonly [K in keyof typeof BACKUP_LIMITS]: number }

/** Image types the app stores (canvas crops are PNG), with their file signatures. */
const IMAGE_SIGNATURES: Record<string, number[]> = {
  'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  'image/jpeg': [0xff, 0xd8, 0xff],
  'image/webp': [0x52, 0x49, 0x46, 0x46], // "RIFF"; "WEBP" checked at offset 8 below
  'image/gif': [0x47, 0x49, 0x46, 0x38],
}

/** Rejection whose message is safe to show to the user. */
export class BackupError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BackupError'
  }
}

const NOT_A_BACKUP = 'This file isn’t an M8TRX backup.'
const DAMAGED = 'This backup file is damaged or incomplete. Nothing was imported.'
const TOO_LARGE = 'This backup file is too large to restore.'
const NEWER_VERSION = 'This backup was made by a newer version of M8TRX. Update the app and try again.'

// ---- Export ------------------------------------------------------------------

export interface BackupMetadata {
  appName: string
  appVersion: string
  now: Date
}

/** Timestamped file name, e.g. `m8trx-backup-2026-11-14.m8trx` (local date). */
export function backupFileName(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `m8trx-backup-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}${BACKUP_FILE_EXTENSION}`
}

/**
 * Serialises `cards` (in wallet order) as a version-1 backup document.
 * Rejects with a BackupError if a stored image can't be read.
 */
export async function createBackup(cards: readonly LoyaltyCard[], meta: BackupMetadata): Promise<string> {
  const exported = []
  for (const card of cards) {
    exported.push({
      id: card.id,
      schemaVersion: card.schemaVersion,
      storeName: card.storeName,
      color: card.color,
      ...(card.notes !== undefined ? { notes: card.notes } : {}),
      createdAt: card.createdAt,
      updatedAt: card.updatedAt,
      barcode: await exportBarcode(card),
    })
  }
  return JSON.stringify({
    format: BACKUP_FORMAT_ID,
    version: BACKUP_FORMAT_VERSION,
    exportedAt: meta.now.toISOString(),
    app: { name: meta.appName, version: meta.appVersion },
    order: cards.map((card) => card.id),
    cards: exported,
  })
}

async function exportBarcode(card: LoyaltyCard) {
  const barcode = card.barcode
  if (barcode.kind !== 'image') return barcode
  let bytes: Uint8Array
  try {
    bytes = await blobBytes(barcode.image)
  } catch {
    throw new BackupError(`Couldn’t read the saved image for “${card.storeName}”. No backup was created.`)
  }
  // Prefer the signature over Blob.type, which some engines lose on storage.
  const mimeType = sniffImageType(bytes) ?? barcode.image.type
  if (!isSupportedImageType(mimeType)) {
    throw new BackupError(`The saved image for “${card.storeName}” is in a format M8TRX can’t back up.`)
  }
  return {
    kind: 'image' as const,
    mimeType,
    byteLength: bytes.byteLength,
    data: bytesToBase64(bytes),
    ...(barcode.detectedValue !== undefined ? { detectedValue: barcode.detectedValue } : {}),
    ...(barcode.detectedFormat !== undefined ? { detectedFormat: barcode.detectedFormat } : {}),
  }
}

// ---- Restore: reading and validation -------------------------------------------

/** Reads and validates a user-chosen file. Size is checked before reading. */
export async function readBackupFile(file: Blob): Promise<LoyaltyCard[]> {
  if (file.size === 0) throw new BackupError(NOT_A_BACKUP)
  if (file.size > BACKUP_LIMITS.fileBytes) throw new BackupError(TOO_LARGE)
  let text: string
  try {
    text = await file.text()
  } catch {
    throw new BackupError('Couldn’t read that file. Nothing was imported.')
  }
  return parseBackup(text)
}

/**
 * Validates a complete backup document and returns its cards in wallet
 * order, or throws a BackupError. All-or-nothing: one invalid card rejects
 * the whole file, so a restore can never import a partial or corrupted set.
 */
export function parseBackup(text: string, limits: BackupLimits = BACKUP_LIMITS): LoyaltyCard[] {
  if (text.length > limits.fileBytes) throw new BackupError(TOO_LARGE)
  let doc: unknown
  try {
    doc = JSON.parse(text)
  } catch {
    throw new BackupError(NOT_A_BACKUP)
  }
  if (!isObject(doc) || doc.format !== BACKUP_FORMAT_ID) throw new BackupError(NOT_A_BACKUP)
  if (typeof doc.version !== 'number' || !Number.isInteger(doc.version) || doc.version < 1) {
    throw new BackupError(DAMAGED)
  }
  if (doc.version > BACKUP_FORMAT_VERSION) throw new BackupError(NEWER_VERSION)

  const { cards, order } = doc
  if (!Array.isArray(cards) || !Array.isArray(order)) throw new BackupError(DAMAGED)
  if (cards.length > limits.cards) {
    throw new BackupError(`This backup has more than ${limits.cards} cards, which M8TRX can’t restore.`)
  }

  const budget = { imageBytes: 0 }
  const byId = new Map<string, LoyaltyCard>()
  for (const raw of cards) {
    const card = parseCard(raw, budget, limits)
    if (byId.has(card.id)) throw new BackupError(DAMAGED)
    byId.set(card.id, card)
  }

  // The order must name every card exactly once and nothing else.
  if (order.length !== byId.size || new Set(order).size !== order.length) throw new BackupError(DAMAGED)
  return order.map((id) => {
    const card = typeof id === 'string' ? byId.get(id) : undefined
    if (!card) throw new BackupError(DAMAGED)
    return card
  })
}

function parseCard(raw: unknown, budget: { imageBytes: number }, limits: BackupLimits): LoyaltyCard {
  if (!isObject(raw)) throw new BackupError(DAMAGED)
  if (raw.schemaVersion !== CARD_SCHEMA_VERSION) {
    throw new BackupError(typeof raw.schemaVersion === 'number' && raw.schemaVersion > CARD_SCHEMA_VERSION ? NEWER_VERSION : DAMAGED)
  }
  const { id, storeName, color, notes, createdAt, updatedAt } = raw
  if (!isBoundedString(id, limits.idLength) || id === '' || hasControlCharacters(id)) throw new BackupError(DAMAGED)
  if (typeof storeName !== 'string' || validateStoreName(storeName)) throw new BackupError(DAMAGED)
  if (typeof color !== 'string' || validateColor(color)) throw new BackupError(DAMAGED)
  if (notes !== undefined && !isBoundedString(notes, limits.notesLength)) throw new BackupError(DAMAGED)
  if (!isTimestamp(createdAt, limits) || !isTimestamp(updatedAt, limits)) throw new BackupError(DAMAGED)

  const barcode = parseBarcode(raw.barcode, budget, limits)
  if (validateBarcode(barcode)) throw new BackupError(DAMAGED)
  return {
    id,
    schemaVersion: CARD_SCHEMA_VERSION,
    storeName,
    color,
    barcode,
    ...(typeof notes === 'string' && notes !== '' ? { notes } : {}),
    createdAt,
    updatedAt,
  }
}

function parseBarcode(raw: unknown, budget: { imageBytes: number }, limits: BackupLimits): CardBarcode {
  if (!isObject(raw)) throw new BackupError(DAMAGED)
  switch (raw.kind) {
    case 'generated':
      if (!isBarcodeFormat(raw.format) || !isBoundedString(raw.value, limits.valueLength)) throw new BackupError(DAMAGED)
      return { kind: 'generated', format: raw.format, value: raw.value }
    case 'text':
      if (!isBoundedString(raw.value, limits.valueLength)) throw new BackupError(DAMAGED)
      return { kind: 'text', value: raw.value }
    case 'image': {
      const { mimeType, byteLength, data, detectedValue, detectedFormat } = raw
      if (!isSupportedImageType(mimeType)) throw new BackupError(DAMAGED)
      if (typeof byteLength !== 'number' || !Number.isInteger(byteLength) || byteLength <= 0) throw new BackupError(DAMAGED)
      // Check declared sizes before decoding anything.
      if (byteLength > limits.imageBytes) throw new BackupError(TOO_LARGE)
      budget.imageBytes += byteLength
      if (budget.imageBytes > limits.totalImageBytes) throw new BackupError(TOO_LARGE)
      if (typeof data !== 'string' || data.length !== Math.ceil(byteLength / 3) * 4) throw new BackupError(DAMAGED)
      const bytes = base64ToBytes(data)
      if (!bytes || bytes.byteLength !== byteLength) throw new BackupError(DAMAGED)
      // A recognisable signature must agree with the declared type. Bytes
      // with no known signature are accepted (export allows them too, so
      // every backup this app writes can be restored): they are only ever
      // shown through an <img>, never interpreted otherwise.
      const sniffed = sniffImageType(bytes)
      if (sniffed !== null && sniffed !== mimeType) throw new BackupError(DAMAGED)
      if (detectedValue !== undefined && !isBoundedString(detectedValue, limits.detectedLength)) throw new BackupError(DAMAGED)
      if (detectedFormat !== undefined && !isBoundedString(detectedFormat, limits.detectedLength)) throw new BackupError(DAMAGED)
      return {
        kind: 'image',
        image: new Blob([bytes], { type: mimeType }),
        ...(detectedValue !== undefined ? { detectedValue } : {}),
        ...(detectedFormat !== undefined ? { detectedFormat } : {}),
      }
    }
    default:
      throw new BackupError(DAMAGED)
  }
}

// ---- Restore: duplicate planning ------------------------------------------------

export interface RestorePlan {
  /** Every card in the backup. */
  total: number
  /** Cards to add, in backup order; appended after the existing cards. */
  toImport: LoyaltyCard[]
  /** Already in the wallet (same barcode); skipped. */
  duplicates: LoyaltyCard[]
  /** ID already used by a different card; skipped, never overwritten. */
  conflicts: LoyaltyCard[]
  /**
   * The wallet's card IDs, in order, when the plan was made. The import is
   * refused if the wallet no longer matches (e.g. changed in another tab).
   */
  expectedOrder: string[]
}

/** Classifies backup cards against the current wallet (see the policy above). */
export async function planRestore(backup: readonly LoyaltyCard[], existing: readonly LoyaltyCard[]): Promise<RestorePlan> {
  const existingById = new Map(existing.map((card) => [card.id, card]))
  const existingKeys = new Set(existing.map((card) => barcodeKey(card.barcode)).filter((key) => key !== null))
  // Image bytes are read lazily and only for image cards of matching size.
  const bytesCache = new Map<Blob, Promise<Uint8Array>>()
  const bytesOf = (blob: Blob) => {
    let pending = bytesCache.get(blob)
    if (!pending) {
      pending = blobBytes(blob)
      bytesCache.set(blob, pending)
    }
    return pending
  }
  const sameBarcode = async (a: CardBarcode, b: CardBarcode): Promise<boolean> => {
    const keyA = barcodeKey(a)
    if (keyA !== null && keyA === barcodeKey(b)) return true
    if (a.kind !== 'image' || b.kind !== 'image' || a.image.size !== b.image.size) return false
    return equalBytes(await bytesOf(a.image), await bytesOf(b.image))
  }
  const existingImages = existing.filter((card) => card.barcode.kind === 'image')

  const plan: RestorePlan = { total: backup.length, toImport: [], duplicates: [], conflicts: [], expectedOrder: existing.map((card) => card.id) }
  for (const card of backup) {
    const sameId = existingById.get(card.id)
    if (sameId) {
      if (await sameBarcode(card.barcode, sameId.barcode)) plan.duplicates.push(card)
      else plan.conflicts.push(card)
      continue
    }
    const key = barcodeKey(card.barcode)
    let duplicate = key !== null && existingKeys.has(key)
    if (!duplicate && card.barcode.kind === 'image') {
      for (const other of existingImages) {
        if (await sameBarcode(card.barcode, other.barcode)) {
          duplicate = true
          break
        }
      }
    }
    if (duplicate) plan.duplicates.push(card)
    else plan.toImport.push(card)
  }
  return plan
}

/**
 * Identity of a barcode for duplicate detection, or null when only the image
 * bytes can identify it. Kinds never match each other: a redrawn code and
 * kept artwork of the same value are different presentations.
 */
function barcodeKey(barcode: CardBarcode): string | null {
  switch (barcode.kind) {
    case 'generated':
      return JSON.stringify(['generated', barcode.format, barcode.value])
    case 'text':
      return JSON.stringify(['text', barcode.value])
    case 'image':
      return barcode.detectedFormat !== undefined && barcode.detectedValue !== undefined
        ? JSON.stringify(['image', barcode.detectedFormat, barcode.detectedValue])
        : null
  }
}

// ---- Byte helpers ---------------------------------------------------------------

/** Blob bytes, with a FileReader fallback for engines without Blob.arrayBuffer. */
export async function blobBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === 'function') return new Uint8Array(await blob.arrayBuffer())
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer))
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.readAsArrayBuffer(blob)
  })
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false
  for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false
  return true
}

/** Own-property check, so names like "constructor" can never pass. */
function isSupportedImageType(value: unknown): value is string {
  return typeof value === 'string' && Object.hasOwn(IMAGE_SIGNATURES, value)
}

function sniffImageType(bytes: Uint8Array): string | null {
  for (const [type, signature] of Object.entries(IMAGE_SIGNATURES)) {
    if (bytes.byteLength < signature.length || !signature.every((byte, i) => bytes[i] === byte)) continue
    if (type === 'image/webp' && String.fromCharCode(...bytes.subarray(8, 12)) !== 'WEBP') continue
    return type
  }
  return null
}

function bytesToBase64(bytes: Uint8Array): string {
  // Chunked so String.fromCharCode never receives too many arguments.
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

/** Strict standard base64 (padded, no whitespace); null when invalid. */
function base64ToBytes(data: string): Uint8Array<ArrayBuffer> | null {
  if (data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) return null
  let binary: string
  try {
    binary = atob(data)
  } catch {
    return null
  }
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

// ---- Small validators -----------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isBoundedString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length <= max
}

function hasControlCharacters(value: string): boolean {
  // eslint-disable-next-line no-control-regex
  return /[\u0000-\u001f\u007f]/.test(value)
}

function isTimestamp(value: unknown, limits: BackupLimits): value is string {
  return isBoundedString(value, limits.timestampLength) && value !== '' && Number.isFinite(Date.parse(value))
}
