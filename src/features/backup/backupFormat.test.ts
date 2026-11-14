/**
 * Backup format tests (v0.5.0): export fidelity, strict validation of
 * untrusted files, and the duplicate/conflict restore policy. Host tests in
 * jsdom; storage is covered in indexedDbCardRepository.test.ts and the whole
 * flow in App.test.tsx.
 */
import { describe, expect, it } from 'vitest'
import type { CardBarcode, LoyaltyCard } from '../cards/card.ts'
import {
  BACKUP_FORMAT_ID,
  BACKUP_FORMAT_VERSION,
  BACKUP_LIMITS,
  BackupError,
  backupFileName,
  blobBytes,
  createBackup,
  parseBackup,
  planRestore,
  readBackupFile,
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
  card('c', 'Coffee', { kind: 'generated', format: 'code128', value: '  0012 3456 ' }, { color: 'red' }),
  card('a', 'Grocer', { kind: 'generated', format: 'ean13', value: '4006381333931' }),
  card('q', 'Gym', { kind: 'generated', format: 'qrcode', value: 'MEMBER-42' }),
  card('t', 'Library', { kind: 'text', value: '000123 45-AB' }, { notes: 'Stamp card' }),
  card('i', 'Logo Shop', { kind: 'image', image: new Blob([artwork], { type: 'image/png' }), detectedFormat: 'QR code', detectedValue: ' Gold 7 ' }),
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
      card('x', 'Same QR, other crop', { kind: 'image', image: new Blob([imageBytes(PNG, 10)], { type: 'image/png' }), detectedFormat: 'QR code', detectedValue: ' Gold 7 ' }),
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
