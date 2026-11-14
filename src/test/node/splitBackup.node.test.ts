// @vitest-environment node
/**
 * Tests for scripts/split-m8trx-backup.py, the advanced recovery tool for
 * oversized backups (README: "Advanced: Working With Oversized M8TRX
 * Backups"). Runs the real script with `python3` on synthetic backups (no
 * personal data) in temporary directories, then passes every part through
 * the app's own parseBackup() and planRestore().
 *
 * Host test in Node; requires python3 on PATH.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BACKUP_LIMITS, createBackup, parseBackup, planRestore } from '../../features/backup/backupFormat.ts'
import type { CardBarcode, LoyaltyCard } from '../../features/cards/card.ts'

const SCRIPT = join(import.meta.dirname, '../../../scripts/split-m8trx-backup.py')
const MIB = 1024 * 1024
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const meta = { appName: 'M8TRX', appVersion: '0.5.0', now: new Date('2026-11-14T18:00:00.000Z') }

type Doc = { format: string; version: number; exportedAt: string; app: unknown; order: string[]; cards: Array<Record<string, unknown> & { id: string }> }

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'm8trx-split-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function runSplit(...args: string[]) {
  const result = spawnSync('python3', ['-I', SCRIPT, ...args], { encoding: 'utf-8', maxBuffer: 16 * MIB })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

function card(id: string, storeName: string, barcode: CardBarcode, extra: Partial<LoyaltyCard> = {}): LoyaltyCard {
  return { id, schemaVersion: 2, storeName, color: 'teal', barcode, createdAt: '2026-03-01T10:00:00.000Z', updatedAt: '2026-04-01T10:00:00.000Z', ...extra }
}

function image(seed: number, size: number): Blob {
  const bytes = new Uint8Array(size)
  bytes.set(PNG)
  for (let i = PNG.length; i < size; i++) bytes[i] = (i * 29 + seed * 11) & 0xff
  return new Blob([bytes], { type: 'image/png' })
}

/** Writes a backup document into the temporary directory and returns its path. */
function writeBackup(text: string, name = 'wallet.m8trx') {
  const path = join(dir, name)
  writeFileSync(path, text)
  return path
}

function parts(): string[] {
  return readdirSync(dir).filter((name) => name.includes('-part-')).sort()
}

const readPart = (name: string) => readFileSync(join(dir, name), 'utf-8')

describe('split-m8trx-backup.py', () => {
  it('uses exactly the app’s standard restore limits', () => {
    const printed = JSON.parse(execFileSync('python3', ['-I', SCRIPT, '--print-limits'], { encoding: 'utf-8' }))
    expect(printed).toEqual({ ...BACKUP_LIMITS })
  })

  it('splits an oversized backup into restorable parts with unmodified cards, in wallet order', async () => {
    // 16 x 4 MiB images (64 MiB, over the 60 MiB limit) between ordinary cards.
    const wallet: LoyaltyCard[] = []
    for (let i = 0; i < 16; i++) {
      wallet.push(card(`img-${i}`, `Artwork ${i}`, { kind: 'image', image: image(i, 4 * MIB), detectedFormat: 'QR code', detectedValue: ` SAMPLE-${i} ` }))
      wallet.push(card(`gen-${i}`, `Sample Store ${i}`, { kind: 'generated', format: 'code128', value: `  0000 ${i} ` }, { notes: `Synthetic note ${i} – ünïcødé ☕` }))
    }
    const text = await createBackup(wallet, meta)
    const input = writeBackup(text)
    expect(() => parseBackup(text)).toThrow(/too large/) // not restorable as one file

    const result = runSplit(input)
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
    expect(parts()).toEqual(['wallet-part-01-of-02.m8trx', 'wallet-part-02-of-02.m8trx'])
    expect(readFileSync(input, 'utf-8')).toBe(text) // original untouched

    const original = JSON.parse(text) as Doc
    const byId = new Map(original.cards.map((c) => [c.id, c]))
    const restoredIds: string[] = []
    for (const name of parts()) {
      const partText = readPart(name)
      const part = JSON.parse(partText) as Doc
      // Metadata copied; order names exactly this part's cards; records unchanged.
      expect(part.format).toBe('m8trx-backup')
      expect(part.version).toBe(1)
      expect(part.exportedAt).toBe(original.exportedAt)
      expect(part.app).toEqual(original.app)
      expect(part.order).toEqual(part.cards.map((c) => c.id))
      for (const record of part.cards) expect(record).toEqual(byId.get(record.id))
      // Within every standard restore limit, and accepted by the app's own parser.
      expect(statSync(join(dir, name)).size).toBeLessThanOrEqual(BACKUP_LIMITS.fileBytes)
      const restored = parseBackup(partText)
      expect(restored.map((c) => c.id)).toEqual(part.order)
      restoredIds.push(...part.order)
    }
    expect(restoredIds).toEqual(original.order)
    // The first part is filled to the 60 MiB image budget: 15 images.
    expect((JSON.parse(readPart(parts()[0]!)) as Doc).order.filter((id) => id.startsWith('img-'))).toHaveLength(15)
  }, 120_000)

  it('restores part by part: appends in import order, skips duplicates, keeps existing cards', async () => {
    const wallet = Array.from({ length: 5 }, (_, i) =>
      card(`c${i}`, `Sample ${i}`, i % 2 ? { kind: 'text', value: `TXT ${i}` } : { kind: 'image', image: image(i, 300) }),
    )
    const input = writeBackup(await createBackup(wallet, meta))
    expect(runSplit(input, '--max-cards', '2').status).toBe(0)
    expect(parts()).toEqual(['wallet-part-01-of-03.m8trx', 'wallet-part-02-of-03.m8trx', 'wallet-part-03-of-03.m8trx'])

    const existing: LoyaltyCard[] = [card('mine', 'Already here', { kind: 'text', value: 'MINE' })]
    let stored = [...existing]
    // Import part 3 first to show that order follows import sequence.
    for (const name of [parts()[2]!, parts()[0]!, parts()[1]!]) {
      const plan = await planRestore(parseBackup(readPart(name)), stored)
      expect(plan.duplicates).toEqual([])
      stored = [...stored, ...plan.toImport]
    }
    expect(stored.map((c) => c.id)).toEqual(['mine', 'c4', 'c0', 'c1', 'c2', 'c3'])
    // Importing a part again adds nothing.
    const again = await planRestore(parseBackup(readPart(parts()[0]!)), stored)
    expect(again.toImport).toEqual([])
    expect(again.duplicates.map((c) => c.id)).toEqual(['c0', 'c1'])
  })

  it('honours a smaller image budget and writes deterministic names into --output-dir', async () => {
    const wallet = Array.from({ length: 4 }, (_, i) => card(`i${i}`, `Image ${i}`, { kind: 'image', image: image(i, 400 * 1024) }))
    const input = writeBackup(await createBackup(wallet, meta), 'm8trx-backup-2026-11-14.m8trx')
    const out = join(dir, 'out')
    expect(runSplit(input, '--output-dir', out, '--max-image-mib', '0.8').status).toBe(0)
    expect(readdirSync(out).sort()).toEqual(['m8trx-backup-2026-11-14-part-01-of-02.m8trx', 'm8trx-backup-2026-11-14-part-02-of-02.m8trx'])
    for (const name of readdirSync(out)) expect(parseBackup(readFileSync(join(out, name), 'utf-8'))).toHaveLength(2)
  })

  it('never overwrites existing files', async () => {
    const input = writeBackup(await createBackup([card('a', 'A', { kind: 'text', value: '1' }), card('b', 'B', { kind: 'text', value: '2' })], meta))
    expect(runSplit(input, '--max-cards', '1').status).toBe(0)
    writeFileSync(join(dir, parts()[1]!), 'keep me')
    rmSync(join(dir, parts()[0]!))
    const result = runSplit(input, '--max-cards', '1')
    expect(result.status).toBe(1)
    expect(result.stderr).toMatch(/refusing to overwrite/)
    expect(parts()).toEqual(['wallet-part-02-of-02.m8trx'])
    expect(readPart(parts()[0]!)).toBe('keep me')
  })

  it('rejects malformed backups and writes nothing', async () => {
    const valid = JSON.parse(await createBackup([card('i', 'Img', { kind: 'image', image: image(1, 300) }), card('t', 'Txt', { kind: 'text', value: 'X' })], meta)) as Doc
    const imageCard = valid.cards[0]!
    const barcode = imageCard.barcode as Record<string, unknown>
    const cases: Array<[string, RegExp]> = [
      ['not json', /invalid JSON/],
      [JSON.stringify({ ...valid, format: 'other' }), /not an M8TRX backup/],
      [JSON.stringify({ ...valid, version: 2 }), /newer/],
      [JSON.stringify({ ...valid, order: ['i'] }), /order/],
      [JSON.stringify({ ...valid, order: ['i', 'i'] }), /order/],
      [JSON.stringify({ ...valid, cards: [imageCard, imageCard], order: ['i', 'i'] }), /duplicate card id/],
      [JSON.stringify({ ...valid, cards: [{ ...imageCard, barcode: { ...barcode, data: `${(barcode.data as string).slice(0, -4)}@@@@` } }, valid.cards[1]] }), /malformed image data/],
      [JSON.stringify({ ...valid, cards: [{ ...imageCard, barcode: { ...barcode, mimeType: 'image/jpeg' } }, valid.cards[1]] }), /mimeType/],
      [JSON.stringify({ ...valid, cards: [{ ...imageCard, id: 'x'.repeat(129) }, valid.cards[1]], order: ['x'.repeat(129), 't'] }), /id/],
      [JSON.stringify({ ...valid, cards: [imageCard, { ...valid.cards[1], notes: 'n'.repeat(10_001) }] }), /notes/],
      [JSON.stringify(valid).replace('"format":"m8trx-backup"', '"format":"m8trx-backup","format":"m8trx-backup"'), /duplicate JSON key/],
      [JSON.stringify(valid).replace('"version":1', '"version":NaN'), /invalid JSON/],
    ]
    for (const [text, message] of cases) {
      const input = writeBackup(text, 'bad.m8trx')
      const result = runSplit(input)
      expect(result.status, text.slice(0, 80)).toBe(1)
      expect(result.stderr).toMatch(message)
      expect(parts()).toEqual([])
    }
  })

  it('refuses a card that could never be restored (image over the 4 MiB per-image limit)', () => {
    const bytes = Buffer.alloc(4 * MIB + 1, 7)
    Buffer.from(PNG).copy(bytes)
    const doc = {
      format: 'm8trx-backup',
      version: 1,
      exportedAt: meta.now.toISOString(),
      app: { name: 'M8TRX', version: '0.5.0' },
      order: ['big'],
      cards: [{ ...card('big', 'Big', { kind: 'text', value: '1' }), barcode: { kind: 'image', mimeType: 'image/png', byteLength: bytes.byteLength, data: bytes.toString('base64') } }],
    }
    const result = runSplit(writeBackup(JSON.stringify(doc)))
    expect(result.status).toBe(1)
    expect(result.stderr).toMatch(/per-image limit/)
    expect(parts()).toEqual([])
  })

  it('reports usage errors and refuses limits above the standard ones', () => {
    expect(runSplit().status).toBe(2)
    expect(runSplit(join(dir, 'x.m8trx'), '--max-cards', '1001').status).toBe(2)
    expect(runSplit(join(dir, 'x.m8trx'), '--max-image-mib', '61').status).toBe(2)
    const missing = runSplit(join(dir, 'missing.m8trx'))
    expect(missing.status).toBe(1)
  })
})
