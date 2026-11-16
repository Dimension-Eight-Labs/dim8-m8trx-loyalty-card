/**
 * Backup format tests (v0.5.0): export fidelity, strict validation of
 * untrusted files, and the duplicate/conflict restore policy. Host tests in
 * jsdom; storage is covered in indexedDbCardRepository.test.ts and the whole
 * flow in App.test.tsx.
 */
import { describe, expect, it } from 'vitest'
import type { CardBarcode, LoyaltyCard } from '../cards/card.ts'
import { CARD_ICON_IDS } from '../cards/cardIcons.ts'
import { TILE_COLORS, tileColor } from '../cards/tileColors.ts'
import {
  BACKUP_FORMAT_ID,
  BACKUP_FORMAT_VERSION,
  BACKUP_LIMITS,
  BackupError,
  assessRestoreLimits,
  backupFileName,
  base64Length,
  blobBytes,
  createBackup,
  createBackupExport,
  parseBackup,
  planRestore,
  readBackupFile,
  utf8ByteLength,
  type BackupLimits,
  type BackupStats,
} from './backupFormat.ts'

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const JPEG = [0xff, 0xd8, 0xff, 0xe0]
/** Arbitrary but realistic-looking image bytes, including every byte value. */
function imageBytes(signature = PNG, extra = 300): Uint8Array<ArrayBuffer> {
  return new Uint8Array([...signature, ...Array.from({ length: extra }, (_, i) => (i * 37) % 256)])
}

function card(id: string, storeName: string, barcode: CardBarcode, extra: Partial<LoyaltyCard> = {}): LoyaltyCard {
  return {
    id,
    schemaVersion: 2,
    storeName,
    color: 'teal',
    barcode,
    createdAt: '2026-01-0' + (id.length % 9) + 'T10:00:00.000Z',
    updatedAt: '2026-02-01T10:00:00.000Z',
    ...extra,
  }
}

const artwork = imageBytes()
const wallet: LoyaltyCard[] = [
  card('c', 'Coffee', { kind: 'generated', format: 'code128', value: '  0012 3456 ' }, { color: 'red', icon: 'coffee' }),
  card('a', 'Grocer', { kind: 'generated', format: 'ean13', value: '4006381333931' }),
  card('q', 'Gym', { kind: 'generated', format: 'qrcode', value: 'MEMBER-42' }, { icon: 'fitness' }),
  card('t', 'Library', { kind: 'text', value: '000123 45-AB' }, { notes: 'Stamp card' }),
  card('i', 'Logo Shop', { kind: 'image', image: new Blob([artwork], { type: 'image/png' }), detectedFormat: 'QR code', detectedValue: ' Gold 7 ' }, { icon: 'retail' }),
  card('u', 'Old Pass', { kind: 'image', image: new Blob([imageBytes(JPEG, 50)], { type: 'image/jpeg' }) }),
]
const meta = { appName: 'M8TRX', appVersion: '0.5.0', now: new Date('2026-11-14T18:00:00.000Z') }

async function backupOf(cards: readonly LoyaltyCard[] = wallet) {
  return JSON.parse(await createBackup(cards, meta)) as Record<string, unknown> & { cards: Record<string, unknown>[]; order: string[] }
}

function expectRejected(doc: unknown, message?: RegExp) {
  const text = typeof doc === 'string' ? doc : JSON.stringify(doc)
  expect(() => parseBackup(text)).toThrow(BackupError)
  if (message) expect(() => parseBackup(text)).toThrow(message)
}

describe('backup export', () => {
  it('writes a versioned document with app metadata and the wallet order', async () => {
    const doc = await backupOf()
    expect(doc.format).toBe(BACKUP_FORMAT_ID)
    expect(doc.version).toBe(BACKUP_FORMAT_VERSION)
    expect(doc.exportedAt).toBe('2026-11-14T18:00:00.000Z')
    expect(doc.app).toEqual({ name: 'M8TRX', version: '0.5.0' })
    expect(doc.order).toEqual(['c', 'a', 'q', 't', 'i', 'u'])
    expect(doc.cards.map((c) => c.id)).toEqual(doc.order)
  })

  it('stores generated and text barcodes exactly (no trimming) and images as base64 of the stored bytes', async () => {
    const doc = await backupOf()
    expect(doc.cards[0]!.barcode).toEqual({ kind: 'generated', format: 'code128', value: '  0012 3456 ' })
    expect(doc.cards[3]!.barcode).toEqual({ kind: 'text', value: '000123 45-AB' })
    expect(doc.cards[3]!.notes).toBe('Stamp card')
    const image = doc.cards[4]!.barcode as Record<string, unknown>
    expect(image).toMatchObject({ kind: 'image', mimeType: 'image/png', byteLength: artwork.byteLength, detectedFormat: 'QR code', detectedValue: ' Gold 7 ' })
    expect(Uint8Array.from(atob(image.data as string), (ch) => ch.charCodeAt(0))).toEqual(artwork)
  })

  it('names the file with the local date and the .m8trx extension', () => {
    expect(backupFileName(new Date(2026, 0, 5, 9, 30))).toBe('m8trx-backup-2026-01-05.m8trx')
  })
})

describe('backup round trip', () => {
  it('restores every card field, the order, and the exact artwork bytes', async () => {
    const restored = parseBackup(await createBackup(wallet, meta))
    expect(restored.map((c) => c.id)).toEqual(wallet.map((c) => c.id))
    for (const [index, original] of wallet.entries()) {
      const copy = restored[index]!
      const { barcode: originalBarcode, ...originalRest } = original
      const { barcode: copyBarcode, ...copyRest } = copy
      expect(copyRest).toEqual(originalRest)
      if (originalBarcode.kind === 'image' && copyBarcode.kind === 'image') {
        const { image: a, ...aRest } = originalBarcode
        const { image: b, ...bRest } = copyBarcode
        expect(bRest).toEqual(aRest)
        expect(b.type).toBe(a.type)
        expect(await blobBytes(b)).toEqual(await blobBytes(a))
      } else {
        expect(copyBarcode).toEqual(originalBarcode)
      }
    }
  })

  it('follows the explicit order even when the cards array is in another order', async () => {
    const doc = await backupOf()
    doc.cards.reverse()
    expect(parseBackup(JSON.stringify(doc)).map((c) => c.id)).toEqual(['c', 'a', 'q', 't', 'i', 'u'])
  })

  it('accepts an empty wallet backup', async () => {
    expect(parseBackup(await createBackup([], meta))).toEqual([])
  })
})

describe('palette color identifiers (industrial palette, v0.6.1)', () => {
  /*
   * The industrial palette kept the pre-0.6.1 color ids as opaque persistence
   * keys, so the backup wire format is unchanged: a backup exported before the
   * palette change carries the same id strings and must restore unmodified.
   */
  const LEGACY_IDS = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'indigo', 'purple', 'pink', 'brown', 'slate', 'white']
  const allColors = LEGACY_IDS.map((color, i) => card(`k${i}`, `Shop ${i}`, { kind: 'text', value: `T${i}` }, { color }))

  it('exports each card’s stored legacy id verbatim', async () => {
    const doc = await backupOf(allColors)
    expect(doc.cards.map((c) => c.color)).toEqual(LEGACY_IDS)
  })

  it('restores a backup containing every legacy id, unchanged and in order, onto a valid new palette color', async () => {
    const restored = parseBackup(await createBackup(allColors, meta))
    expect(restored.map((c) => [c.id, c.color])).toEqual(allColors.map((c) => [c.id, c.color]))
    const labels = new Set(TILE_COLORS.map((c) => c.label))
    for (const c of restored) expect(labels.has(tileColor(c.color).label)).toBe(true)
    expect(new Set(restored.map((c) => tileColor(c.color).label)).size).toBe(12)
  })
  // v0.6.1 expansion: new ids use the unchanged version-1 backup format.
  it('exports and restores the three new colours and the Gear icon verbatim', async () => {
    const added = [
      card('n1', 'Machine Shop', { kind: 'text', value: 'N1' }, { color: 'petrol-teal', icon: 'gear' }),
      card('n2', 'Surplus', { kind: 'text', value: 'N2' }, { color: 'olive' }),
      card('n3', 'Florist', { kind: 'text', value: 'N3' }, { color: 'dusty-rose', icon: 'gear' }),
    ]
    const doc = await backupOf(added)
    expect(doc.version).toBe(1)
    expect(doc.cards.map((c) => [c.color, c.icon])).toEqual([
      ['petrol-teal', 'gear'],
      ['olive', undefined],
      ['dusty-rose', 'gear'],
    ])
    const restored = parseBackup(JSON.stringify(doc))
    expect(restored.map((c) => [c.id, c.color, c.icon])).toEqual([
      ['n1', 'petrol-teal', 'gear'],
      ['n2', 'olive', undefined],
      ['n3', 'dusty-rose', 'gear'],
    ])
    expect(restored.map((c) => tileColor(c.color).label)).toEqual(['Petrol Teal', 'Olive', 'Dusty Rose'])
  })

  it('detects a duplicate of a card using a new colour and the Gear icon', async () => {
    const machine = card('n1', 'Machine Shop', { kind: 'text', value: 'N1' }, { color: 'petrol-teal', icon: 'gear' })
    const cards = parseBackup(await createBackup([machine], meta))
    // Same card already present under another id, recoloured and without an icon.
    const plan = await planRestore(cards, [{ ...machine, id: 'other', color: 'dusty-rose', icon: undefined }])
    expect(plan.duplicates.map((c) => c.id)).toEqual(['n1'])
  })
})

describe('category icons (v0.6.0)', () => {
  it('exports a chosen icon and omits the field for None', async () => {
    const doc = await backupOf()
    expect(doc.cards.map((c) => c.icon)).toEqual(['coffee', undefined, 'fitness', undefined, 'retail', undefined])
    expect(doc.cards.filter((c) => 'icon' in c)).toHaveLength(3)
    expect(doc.version).toBe(1)
  })

  it('round-trips every supported icon', async () => {
    const cards = CARD_ICON_IDS.map((icon, i) => card(`icon-${i}`, `Store ${i}`, { kind: 'text', value: `N${i}` }, { icon }))
    expect(parseBackup(await createBackup(cards, meta)).map((c) => c.icon)).toEqual([...CARD_ICON_IDS])
  })

  it('restores a card without an icon (e.g. a 0.5.x backup) as None', async () => {
    const doc = await backupOf()
    for (const c of doc.cards) delete c.icon
    const restored = parseBackup(JSON.stringify(doc))
    expect(restored.every((c) => !('icon' in c))).toBe(true)
  })

  it('keeps duplicate detection independent of the icon', async () => {
    const cards = parseBackup(await createBackup(wallet, meta))
    const existing = [{ ...wallet[0]!, id: 'other', icon: 'events' as const }]
    const plan = await planRestore(cards, existing)
    expect(plan.duplicates.map((c) => c.id)).toContain('c')
  })
})

describe('backup validation (untrusted input)', () => {
  it('rejects files that are not M8TRX backups', () => {
    expectRejected('not json', /isn’t an M8TRX backup/)
    expectRejected('[]', /isn’t an M8TRX backup/)
    expectRejected({ format: 'something-else', version: 1, cards: [], order: [] }, /isn’t an M8TRX backup/)
  })

  it('rejects newer and malformed format versions', async () => {
    const doc = await backupOf()
    expectRejected({ ...doc, version: 2 }, /newer version of M8TRX/)
    expectRejected({ ...doc, version: 0 }, /damaged/)
    expectRejected({ ...doc, version: '1' }, /damaged/)
    expectRejected({ ...doc, version: 1.5 }, /damaged/)
  })

  it('rejects cards from a newer card schema', async () => {
    const doc = await backupOf()
    doc.cards[0]!.schemaVersion = 3
    expectRejected(doc, /newer version/)
  })

  it('rejects an order that does not name every card exactly once', async () => {
    const doc = await backupOf()
    expectRejected({ ...doc, order: doc.order.slice(1) })
    expectRejected({ ...doc, order: [...doc.order, 'ghost'] })
    expectRejected({ ...doc, order: ['c', 'c', ...doc.order.slice(2)] })
    expectRejected({ ...doc, order: [...doc.order.slice(1), 'ghost'] })
    expectRejected({ ...doc, order: undefined })
  })

  it('rejects duplicate card IDs', async () => {
    const doc = await backupOf([wallet[0]!, wallet[0]!])
    expectRejected(doc)
  })

  it('rejects invalid card fields', async () => {
    const cases: Array<(c: Record<string, unknown>) => void> = [
      (c) => (c.id = ''),
      (c) => (c.id = 'x'.repeat(BACKUP_LIMITS.idLength + 1)),
      (c) => (c.id = 'line\nbreak'),
      (c) => (c.storeName = '   '),
      (c) => (c.storeName = 'x'.repeat(81)),
      (c) => (c.color = 'chartreuse'),
      (c) => (c.icon = 'rocket'),
      (c) => (c.icon = null),
      (c) => (c.icon = 7),
      (c) => (c.icon = ''),
      (c) => (c.createdAt = 'yesterday'),
      (c) => delete c.updatedAt,
      (c) => (c.notes = 42),
      (c) => (c.barcode = { kind: 'generated', format: 'ean13', value: '4006381333932' }), // bad check digit
      (c) => (c.barcode = { kind: 'generated', format: 'made-up', value: '1' }),
      (c) => (c.barcode = { kind: 'text', value: '' }),
      (c) => (c.barcode = { kind: 'mystery' }),
      (c) => (c.barcode = null),
    ]
    for (const mutate of cases) {
      const doc = await backupOf()
      mutate(doc.cards[0]!)
      expectRejected(doc, /damaged/)
    }
  })

  it('rejects malformed, mislabelled or oversized images', async () => {
    const mutations: Array<[(b: Record<string, unknown>) => void, RegExp]> = [
      [(b) => (b.data = (b.data as string).slice(0, -4) + '@@@@'), /damaged/],
      [(b) => (b.data = ` ${b.data as string}`.slice(0, (b.data as string).length)), /damaged/],
      [(b) => (b.byteLength = (b.byteLength as number) + 3), /damaged/],
      [(b) => (b.mimeType = 'image/jpeg'), /damaged/], // PNG bytes labelled JPEG
      [(b) => (b.mimeType = 'image/svg+xml'), /damaged/], // not an allowed type
      [(b) => (b.mimeType = 'constructor'), /damaged/],
      [(b) => (b.byteLength = BACKUP_LIMITS.imageBytes + 1), /too large/],
      [(b) => delete b.data, /damaged/],
    ]
    for (const [mutate, message] of mutations) {
      const doc = await backupOf()
      mutate(doc.cards[4]!.barcode as Record<string, unknown>)
      expectRejected(doc, message)
    }
  })

  it('limits the number of cards and the total image size', async () => {
    const doc = await backupOf([wallet[0]!])
    const many = Array.from({ length: BACKUP_LIMITS.cards + 1 }, (_, i) => ({ ...doc.cards[0]!, id: `id-${i}` }))
    expectRejected({ ...doc, cards: many, order: many.map((c) => c.id) }, /more than 1000 cards/)

    // Total decoded image bytes: two ~308-byte images fit a 700-byte budget, three don't.
    const small = { ...BACKUP_LIMITS, imageBytes: 400, totalImageBytes: 700 }
    const images = await backupOf([wallet[4]!])
    const withImages = (n: number) => {
      const cards = Array.from({ length: n }, (_, i) => ({ ...images.cards[0]!, id: `img-${i}` }))
      return JSON.stringify({ ...images, cards, order: cards.map((c) => c.id) })
    }
    expect(parseBackup(withImages(2), small)).toHaveLength(2)
    expect(() => parseBackup(withImages(3), small)).toThrow(/too large/)
    // A single image over the per-image limit is refused before decoding.
    expect(() => parseBackup(withImages(1), { ...small, imageBytes: 100 })).toThrow(/too large/)
  })

  it('counts the file limit in UTF-8 bytes, not UTF-16 characters', async () => {
    const text = await createBackup([card('n', 'Café ☕', { kind: 'text', value: 'Ünïcødé 🎟️' }, { notes: 'naïve' })], meta)
    const bytes = new TextEncoder().encode(text).byteLength
    expect(utf8ByteLength(text)).toBe(bytes)
    expect(bytes).toBeGreaterThan(text.length)
    expect(parseBackup(text, { ...BACKUP_LIMITS, fileBytes: bytes })).toHaveLength(1)
    // Fits as UTF-16 code units, but not as UTF-8 bytes: refused.
    expect(() => parseBackup(text, { ...BACKUP_LIMITS, fileBytes: bytes - 1 })).toThrow(/too large/)
    expect(text.length).toBeLessThanOrEqual(bytes - 1)
    expect(utf8ByteLength('\ud800x')).toBe(4) // lone surrogate: U+FFFD (3 bytes), as Blob writes it
  })

  it('checks the file size before reading it', async () => {
    const huge = { size: BACKUP_LIMITS.fileBytes + 1, text: () => Promise.reject(new Error('must not read')) } as unknown as Blob
    await expect(readBackupFile(huge)).rejects.toThrow(/too large/)
    await expect(readBackupFile(new Blob([]))).rejects.toThrow(/isn’t an M8TRX backup/)
    await expect(readBackupFile(new Blob([await createBackup(wallet.slice(0, 2), meta)]))).resolves.toHaveLength(2)
  })
})

describe('restore planning', () => {
  it('imports everything into an empty wallet, in backup order', async () => {
    const cards = parseBackup(await createBackup(wallet, meta))
    const plan = await planRestore(cards, [])
    expect(plan.total).toBe(6)
    expect(plan.toImport.map((c) => c.id)).toEqual(['c', 'a', 'q', 't', 'i', 'u'])
    expect(plan.duplicates).toEqual([])
    expect(plan.conflicts).toEqual([])
    expect(plan.expectedOrder).toEqual([])
  })

  it('skips cards already in the wallet and flags ID conflicts, never overwriting', async () => {
    const cards = parseBackup(await createBackup(wallet, meta))
    const existing: LoyaltyCard[] = [
      // Same ID, same barcode, renamed since the backup: a duplicate.
      { ...wallet[0]!, storeName: 'Coffee (renamed)' },
      // Same ID, different barcode: a conflict.
      card('a', 'Something else', { kind: 'generated', format: 'code128', value: 'DIFFERENT' }),
      // Different ID, same generated barcode: a duplicate.
      card('other-q', 'Gym copy', { kind: 'generated', format: 'qrcode', value: 'MEMBER-42' }),
      // Different ID, identical image bytes but no detected value: a duplicate.
      card('other-u', 'Old Pass copy', { kind: 'image', image: new Blob([imageBytes(JPEG, 50)], { type: 'image/jpeg' }) }),
    ]
    const plan = await planRestore(cards, existing)
    expect(plan.duplicates.map((c) => c.id)).toEqual(['c', 'q', 'u'])
    expect(plan.conflicts.map((c) => c.id)).toEqual(['a'])
    expect(plan.toImport.map((c) => c.id)).toEqual(['t', 'i'])
    expect(plan.expectedOrder).toEqual(['c', 'a', 'other-q', 'other-u'])
  })

  it('matches kept artwork by its detected code, and different artwork bytes by content only', async () => {
    const cards = parseBackup(await createBackup([wallet[4]!, wallet[5]!], meta))
    const existing = [
      card('x', 'Same QR, other crop', { kind: 'image', image: new Blob([imageBytes(PNG, 10)], { type: 'image/png' }), detectedFormat: 'QR code', detectedValue: ' Gold 7 ' }, { icon: 'retail' }),
      card('y', 'Different pass', { kind: 'image', image: new Blob([imageBytes(JPEG, 51)], { type: 'image/jpeg' }) }),
    ]
    const plan = await planRestore(cards, existing)
    expect(plan.duplicates.map((c) => c.id)).toEqual(['i'])
    expect(plan.toImport.map((c) => c.id)).toEqual(['u'])
  })

  it('does not treat a text card and a generated card with the same digits as duplicates', async () => {
    const cards = parseBackup(await createBackup([card('n', 'Num', { kind: 'text', value: '4006381333931' })], meta))
    const plan = await planRestore(cards, [wallet[1]!])
    expect(plan.toImport).toHaveLength(1)
  })
})

// ---- Standard restore limit (60 MiB) and oversized exports ---------------------

const MIB = 1024 * 1024
const FULL_IMAGE = BACKUP_LIMITS.imageBytes // 4 MiB, the per-image limit

/** A distinct full-size PNG-signed image: `seed` varies every byte after the signature. */
function bigImage(seed: number, size = FULL_IMAGE): Blob {
  const bytes = new Uint8Array(size)
  bytes.set(PNG)
  for (let i = PNG.length; i < size; i++) bytes[i] = (i * 31 + seed * 7) & 0xff
  return new Blob([bytes], { type: 'image/png' })
}

/** Independent base64 encoder for expectations (chunked for large inputs). */
function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i += 0x4000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x4000))
  return btoa(binary)
}

function imageCards(count: number, size = FULL_IMAGE): LoyaltyCard[] {
  return Array.from({ length: count }, (_, i) => card(`img-${i}`, `Image ${i}`, { kind: 'image', image: bigImage(i, size) }))
}

describe('standard restore limit: 60 MiB of decoded images', () => {
  it('is 62,914,560 bytes, with a file limit that leaves room for base64 and card text', () => {
    expect(BACKUP_LIMITS.totalImageBytes).toBe(62_914_560)
    expect(BACKUP_LIMITS.imageBytes).toBe(4 * MIB)
    expect(BACKUP_LIMITS.cards).toBe(1000)
    // 60 MiB of images is 80 MiB of base64; the file limit must exceed that.
    expect(base64Length(BACKUP_LIMITS.totalImageBytes)).toBe(80 * MIB)
    expect(BACKUP_LIMITS.fileBytes).toBe(96 * MIB)
    expect(BACKUP_LIMITS.fileBytes - base64Length(BACKUP_LIMITS.totalImageBytes)).toBeGreaterThanOrEqual(16 * MIB)
  })

  it('restores exactly 60 MiB of images, although the JSON file is far larger than 60 MiB', async () => {
    const cards = imageCards(15) // 15 x 4 MiB = 60 MiB exactly
    const exported = await createBackupExport(cards, meta)
    expect(exported.stats.totalImageBytes).toBe(BACKUP_LIMITS.totalImageBytes)
    expect(exported.issues).toEqual([])
    expect(exported.stats.fileBytes).toBeGreaterThan(80 * MIB)
    expect(exported.stats.fileBytes).toBeLessThanOrEqual(BACKUP_LIMITS.fileBytes)

    const restored = parseBackup(exported.text)
    expect(restored.map((c) => c.id)).toEqual(cards.map((c) => c.id))
    // Byte-for-byte artwork, checked on the first and last image.
    for (const index of [0, 14]) {
      const a = cards[index]!.barcode
      const b = restored[index]!.barcode
      if (a.kind !== 'image' || b.kind !== 'image') throw new Error('expected image cards')
      expect(await blobBytes(b.image)).toEqual(await blobBytes(a.image))
    }

    // The file-size check before reading accepts the same file.
    const file = { size: exported.stats.fileBytes, text: () => Promise.resolve(exported.text) } as unknown as Blob
    await expect(readBackupFile(file)).resolves.toHaveLength(15)
  }, 60_000)

  it('refuses one byte over the 60 MiB image budget', async () => {
    const doc = JSON.parse(await createBackup(imageCards(15), meta)) as { cards: Record<string, unknown>[]; order: string[] }
    // A one-byte image (no recognisable signature, which restore allows).
    const tiny = { ...doc.cards[0]!, id: 'tiny', barcode: { kind: 'image', mimeType: 'image/png', byteLength: 1, data: btoa('x') } }
    expect(() => parseBackup(JSON.stringify({ ...doc, cards: [...doc.cards, tiny], order: [...doc.order, 'tiny'] }))).toThrow(/too large/)
  }, 60_000)
})

describe('oversized exports', () => {
  it('exports a wallet over 60 MiB completely, unmodified, and reports the image budget', async () => {
    const cards = imageCards(16) // 64 MiB
    const exported = await createBackupExport(cards, meta)
    expect(exported.issues).toEqual(['totalImageBytes'])
    expect(exported.stats).toMatchObject({ cards: 16, totalImageBytes: 64 * MIB, largestImageBytes: FULL_IMAGE, fieldTooLong: false })

    const doc = JSON.parse(exported.text) as { cards: Array<{ id: string; barcode: { byteLength: number; data: string } }>; order: string[] }
    expect(doc.order).toEqual(cards.map((c) => c.id))
    expect(doc.cards.map((c) => c.id)).toEqual(doc.order)
    for (const [index, exportedCard] of doc.cards.entries()) {
      const original = cards[index]!.barcode
      if (original.kind !== 'image') throw new Error('expected image cards')
      expect(exportedCard.barcode.byteLength).toBe(FULL_IMAGE)
      // Every byte of every image, compared as base64 of the original bytes.
      expect(exportedCard.barcode.data.length).toBe(base64Length(FULL_IMAGE))
      expect(exportedCard.barcode.data === toBase64(await blobBytes(original.image))).toBe(true)
    }
    // The exported file is exactly what restore would refuse (and why).
    expect(() => parseBackup(exported.text)).toThrow(/too large/)
  }, 60_000)

  it('reports no issue for ordinary wallets', async () => {
    const exported = await createBackupExport(wallet, meta)
    expect(exported.issues).toEqual([])
    expect(exported.text).toBe(await createBackup(wallet, meta))
    expect(exported.stats.fileBytes).toBe(new TextEncoder().encode(exported.text).byteLength)
  })

  it('reports each exceeded restore limit, and combinations, in a fixed order', async () => {
    const base: BackupStats = { cards: 10, totalImageBytes: 100, largestImageBytes: 50, fileBytes: 1000, fieldTooLong: false }
    const limits = { ...BACKUP_LIMITS, cards: 10, totalImageBytes: 100, imageBytes: 50, fileBytes: 1000 }
    expect(assessRestoreLimits(base, limits)).toEqual([]) // every value exactly at its limit
    expect(assessRestoreLimits({ ...base, totalImageBytes: 101 }, limits)).toEqual(['totalImageBytes'])
    expect(assessRestoreLimits({ ...base, largestImageBytes: 51 }, limits)).toEqual(['imageBytes'])
    expect(assessRestoreLimits({ ...base, cards: 11 }, limits)).toEqual(['cards'])
    expect(assessRestoreLimits({ ...base, fileBytes: 1001 }, limits)).toEqual(['fileBytes'])
    expect(assessRestoreLimits({ ...base, fieldTooLong: true }, limits)).toEqual(['fields'])
    expect(assessRestoreLimits({ cards: 11, totalImageBytes: 101, largestImageBytes: 51, fileBytes: 1001, fieldTooLong: true }, limits)).toEqual([
      'totalImageBytes',
      'imageBytes',
      'cards',
      'fileBytes',
      'fields',
    ])
  })

  it('measures real exports against every limit, and its verdict matches restore', async () => {
    const small: BackupLimits = { ...BACKUP_LIMITS, imageBytes: 400, totalImageBytes: 700 }
    const images = [wallet[4]!, { ...wallet[4]!, id: 'i2' }, { ...wallet[4]!, id: 'i3' }] // three ~308-byte images
    const cases: Array<[LoyaltyCard[], BackupLimits, string[]]> = [
      [images.slice(0, 2), small, []],
      [images, small, ['totalImageBytes']],
      [images.slice(0, 1), { ...small, imageBytes: 100 }, ['imageBytes']],
      [wallet.slice(0, 3), { ...small, cards: 2 }, ['cards']],
      [wallet.slice(0, 1), { ...small, fileBytes: 50 }, ['fileBytes']],
      [[{ ...wallet[3]!, notes: 'n'.repeat(BACKUP_LIMITS.notesLength + 1) }], small, ['fields']],
      [[card('v', 'Long', { kind: 'text', value: 'v'.repeat(BACKUP_LIMITS.valueLength + 1) })], small, ['fields']],
      [[card('x'.repeat(BACKUP_LIMITS.idLength + 1), 'Long ID', { kind: 'text', value: '1' })], small, ['fields']],
      [images, { ...small, cards: 2, fileBytes: 100 }, ['totalImageBytes', 'cards', 'fileBytes']],
    ]
    for (const [cards, limits, expected] of cases) {
      const exported = await createBackupExport(cards, meta, limits)
      expect(exported.issues).toEqual(expected)
      // A file is flagged exactly when restore (with the same limits) refuses it.
      if (expected.length === 0) expect(parseBackup(exported.text, limits)).toHaveLength(cards.length)
      else expect(() => parseBackup(exported.text, limits)).toThrow(BackupError)
    }
  })
})
