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
 * Export is never limited: a wallet beyond those restore limits is still
 * exported completely. `createBackupExport` reports which limits the file
 * exceeds so the UI can warn before the user saves it; the README section
 * "Advanced: Working With Oversized M8TRX Backups" (and
 * scripts/split-m8trx-backup.py) explains how to split such a file into
 * parts that each restore normally.
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

/** Length of the padded standard base64 encoding of `byteLength` bytes. */
export function base64Length(byteLength: number): number {
  return Math.ceil(byteLength / 3) * 4
}

/**
 * Standard restore limits: the single source of truth for what M8TRX can
 * restore from one file, and for when an export warns that its file exceeds
 * them (see `assessRestoreLimits`). Generous for real wallets (a card's
 * stored image is capped at CARD_LIMITS.imageBytes, normally far smaller)
 * while keeping a hostile file from exhausting a phone's memory.
 *
 * Three different sizes are involved and must not be confused:
 * - decoded image bytes: the stored artwork itself (`imageBytes`,
 *   `totalImageBytes`, summed from each image's `byteLength`);
 * - base64 characters: each image as written in the file, 4/3 of its
 *   decoded size (60 MiB of images is 80 MiB of base64);
 * - the complete file: UTF-8 bytes of the whole JSON document (`fileBytes`),
 *   i.e. base64 plus every card's text fields and JSON punctuation.
 */
export const BACKUP_LIMITS = {
  /**
   * Whole file, in UTF-8 bytes; checked before the file is read at all.
   * 96 MiB = the base64 of a full 60 MiB image budget (80 MiB) plus 16 MiB
   * for card text and JSON structure (about 16 KiB per card even at the
   * 1000-card limit), so a backup within the image budget is never refused
   * merely because base64 made its file larger than 60 MiB.
   */
  fileBytes: 96 * MIB,
  cards: 1000,
  /** One decoded image; the same cap the wallet applies when saving a card. */
  imageBytes: CARD_LIMITS.imageBytes,
  /** Sum of all decoded image bytes: 60 MiB = 62,914,560 bytes. */
  totalImageBytes: 60 * MIB,
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
 * A standard restore limit that a backup exceeds, in the order the export
 * warning lists them:
 * - `totalImageBytes`: decoded images sum to more than the image budget;
 * - `imageBytes`: at least one decoded image is over the per-image limit;
 * - `cards`: more cards than one restore accepts;
 * - `fileBytes`: the complete UTF-8 file is over the file-size limit;
 * - `fields`: a card's ID, notes, barcode value or detected code (or a
 *   timestamp) is longer than restore accepts.
 */
export type RestoreLimitIssue = 'totalImageBytes' | 'imageBytes' | 'cards' | 'fileBytes' | 'fields'

/** Measurements of one export, taken from the bytes actually written. */
export interface BackupStats {
  cards: number
  /** Sum of decoded image bytes. */
  totalImageBytes: number
  /** Largest single decoded image, 0 when there are none. */
  largestImageBytes: number
  /** UTF-8 size of the complete JSON document. */
  fileBytes: number
  /** True when any card text field is longer than restore accepts. */
  fieldTooLong: boolean
}

export interface BackupExport {
  /** The complete document: every card, every image byte, nothing omitted. */
  text: string
  stats: BackupStats
  /** Standard restore limits this file exceeds; empty when it restores directly. */
  issues: RestoreLimitIssue[]
}

/** Lists the standard restore limits that a backup with `stats` exceeds. */
export function assessRestoreLimits(stats: BackupStats, limits: BackupLimits = BACKUP_LIMITS): RestoreLimitIssue[] {
  const issues: RestoreLimitIssue[] = []
  if (stats.totalImageBytes > limits.totalImageBytes) issues.push('totalImageBytes')
  if (stats.largestImageBytes > limits.imageBytes) issues.push('imageBytes')
  if (stats.cards > limits.cards) issues.push('cards')
  if (stats.fileBytes > limits.fileBytes) issues.push('fileBytes')
  if (stats.fieldTooLong) issues.push('fields')
  return issues
}

/**
 * Serialises `cards` (in wallet order) as a version-1 backup document and
 * reports which standard restore limits, if any, the result exceeds.
 *
 * Export never truncates, omits or recompresses anything to fit those
 * limits: the user's complete data is always written, and the caller decides
 * (with the user) whether to save an oversized file. Rejects with a
 * BackupError if a stored image can't be read; a browser out-of-memory
 * failure while building a very large document propagates unchanged.
 */
export async function createBackupExport(
  cards: readonly LoyaltyCard[],
  meta: BackupMetadata,
  limits: BackupLimits = BACKUP_LIMITS,
): Promise<BackupExport> {
  const exported = []
  let totalImageBytes = 0
  let largestImageBytes = 0
  let fieldTooLong = false
  for (const card of cards) {
    const barcode = await exportBarcode(card)
    if (barcode.kind === 'image') {
      totalImageBytes += barcode.byteLength
      largestImageBytes = Math.max(largestImageBytes, barcode.byteLength)
    }
    fieldTooLong ||= exceedsFieldLimits(card, limits)
    exported.push({
      id: card.id,
      schemaVersion: card.schemaVersion,
      storeName: card.storeName,
      color: card.color,
      ...(card.notes !== undefined ? { notes: card.notes } : {}),
      createdAt: card.createdAt,
      updatedAt: card.updatedAt,
      barcode,
    })
  }
  const text = JSON.stringify({
    format: BACKUP_FORMAT_ID,
    version: BACKUP_FORMAT_VERSION,
    exportedAt: meta.now.toISOString(),
    app: { name: meta.appName, version: meta.appVersion },
    order: cards.map((card) => card.id),
    cards: exported,
  })
  const stats: BackupStats = { cards: cards.length, totalImageBytes, largestImageBytes, fileBytes: utf8ByteLength(text), fieldTooLong }
  return { text, stats, issues: assessRestoreLimits(stats, limits) }
}

/** Serialises `cards` as a version-1 backup document (see createBackupExport). */
export async function createBackup(cards: readonly LoyaltyCard[], meta: BackupMetadata): Promise<string> {
  return (await createBackupExport(cards, meta)).text
}

/** True when a text field of `card` is longer than parseBackup accepts. */
function exceedsFieldLimits(card: LoyaltyCard, limits: BackupLimits): boolean {
  const { barcode } = card
  return (
    card.id.length > limits.idLength ||
    (card.notes?.length ?? 0) > limits.notesLength ||
    card.createdAt.length > limits.timestampLength ||
    card.updatedAt.length > limits.timestampLength ||
    (barcode.kind !== 'image' && barcode.value.length > limits.valueLength) ||
    (barcode.kind === 'image' &&
      ((barcode.detectedValue?.length ?? 0) > limits.detectedLength || (barcode.detectedFormat?.length ?? 0) > limits.detectedLength))
  )
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
  if (exceedsUtf8Bytes(text, limits.fileBytes)) throw new BackupError(TOO_LARGE)
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
      if (typeof data !== 'string' || data.length !== base64Length(byteLength)) throw new BackupError(DAMAGED)
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

/**
 * UTF-8 size of `text` without allocating an encoded copy (the document can
 * be close to 100 MiB). Lone surrogates count as U+FFFD (3 bytes), as
 * TextEncoder and Blob would write them.
 */
export function utf8ByteLength(text: string): number {
  let bytes = 0
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code < 0x80) bytes += 1
    else if (code < 0x800) bytes += 2
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length && (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      bytes += 4
      i++
    } else bytes += 3
  }
  return bytes
}

/**
 * Whether `text` is more than `maxBytes` in UTF-8. Every UTF-16 code unit
 * takes 1 to 3 UTF-8 bytes (a surrogate pair: 2 units, 4 bytes), which
 * settles most cases without the full count.
 */
function exceedsUtf8Bytes(text: string, maxBytes: number): boolean {
  if (text.length > maxBytes) return true
  if (text.length * 3 <= maxBytes) return false
  return utf8ByteLength(text) > maxBytes
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
