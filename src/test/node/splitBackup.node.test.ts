// @vitest-environment node
/**
 * Tests for scripts/split-m8trx-backup.py, the advanced recovery tool for
 * oversized backups (README: "Advanced: Working With Oversized M8TRX
 * Backups"). Runs the real script with `python3` on synthetic backups (no
 * personal data) in temporary directories, then passes every part through
 * the app's own parseBackup() and planRestore(). Malformed inputs are
 * checked against both: whatever parseBackup() rejects, the script must
 * reject too, before writing any file.
 *
 * Host test in Node; requires python3 on PATH.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BACKUP_LIMITS, createBackup, parseBackup, planRestore } from '../../features/backup/backupFormat.ts'
import { BARCODE_FORMATS, FORMAT_SPECS } from '../../features/barcodes/formats.ts'
import type { CardBarcode, LoyaltyCard } from '../../features/cards/card.ts'
import { CARD_ICON_IDS } from '../../features/cards/cardIcons.ts'
import { TILE_COLORS } from '../../features/cards/tileColors.ts'

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

  it('uses exactly the app’s tile colours, category icons and barcode formats', () => {
    const probe = [
      'import importlib.util, json, sys',
      'spec = importlib.util.spec_from_file_location("splitter", sys.argv[1])',
      'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
      'print(json.dumps({"colors": sorted(m.TILE_COLOR_IDS), "icons": sorted(m.CARD_ICON_IDS), "formats": sorted([*m.GS1_FORMATS, *m.FREE_FORM_FORMATS]),',
      '  "max": {f: n for f, (_, n) in m.FREE_FORM_FORMATS.items()} | {f: n for f, n in m.GS1_FORMATS.items()}}))',
    ].join('\n')
    const printed = JSON.parse(execFileSync('python3', ['-I', '-c', probe, SCRIPT], { encoding: 'utf-8' }))
    expect(printed.colors).toEqual(TILE_COLORS.map((c) => c.id).sort())
    expect(printed.icons).toEqual([...CARD_ICON_IDS].sort())
    expect(printed.formats).toEqual([...BARCODE_FORMATS].sort())
    expect(printed.max).toEqual(Object.fromEntries(BARCODE_FORMATS.map((f) => [f, FORMAT_SPECS[f].maxLength])))
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

  describe('validation matches the app’s restore parser', () => {
    type Mutable = Record<string, unknown>
    /** A valid two-card backup, as plain JSON, to derive malformed variants from. */
    async function baseDoc() {
      return JSON.parse(
        await createBackup(
          [card('g', 'Sample Store', { kind: 'generated', format: 'ean13', value: '4006381333931' }), card('t', 'Text Store', { kind: 'text', value: 'TXT 1' })],
          meta,
        ),
      ) as Doc
    }
    /** The base backup with `edit` applied to a copy of its first card (or to the document). */
    async function variant(edit: { card?: (c: Mutable) => void; doc?: (d: Mutable) => void }): Promise<string> {
      const doc = (await baseDoc()) as unknown as Mutable & { cards: Mutable[] }
      const first = structuredClone(doc.cards[0]!)
      edit.card?.(first)
      doc.cards[0] = first
      edit.doc?.(doc)
      return JSON.stringify(doc)
    }
    const setBarcode = (barcode: Mutable) => (c: Mutable) => {
      c.barcode = barcode
    }
    const generated = (format: unknown, value: unknown) => setBarcode({ kind: 'generated', format, value })

    function expectRejected(text: string, message: RegExp, label: string) {
      const result = runSplit(writeBackup(text, 'bad.m8trx'))
      expect(result.status, label).toBe(1)
      expect(result.stderr, label).toMatch(message)
      expect(result.stderr, label).not.toMatch(/Traceback/)
      expect(parts(), label).toEqual([])
    }

    // Each case is rejected by parseBackup() AND by the script, which writes nothing.
    const sharedRejections: Array<[string, Parameters<typeof variant>[0], RegExp]> = [
      ['unknown tile colour', { card: (c) => void (c.color = 'chartreuse') }, /tile color/],
      ['missing tile colour', { card: (c) => void delete c.color }, /tile color/],
      ['non-string tile colour', { card: (c) => void (c.color = 3) }, /tile color/],
      ['unknown category icon', { card: (c) => void (c.icon = 'rocket') }, /category icon/],
      ['null category icon', { card: (c) => void (c.icon = null) }, /category icon/],
      ['non-string category icon', { card: (c) => void (c.icon = 1) }, /category icon/],
      ['wrong-case category icon', { card: (c) => void (c.icon = 'Coffee') }, /category icon/],
      ['unknown barcode format', { card: generated('made-up', '123') }, /unsupported barcode format/],
      ['missing barcode format', { card: generated(undefined, '123') }, /unsupported barcode format/],
      ['EAN-13 wrong check digit', { card: generated('ean13', '4006381333932') }, /check digit/],
      ['EAN-13 wrong length', { card: generated('ean13', '400638133393') }, /13 digits/],
      ['EAN-13 non-digit', { card: generated('ean13', '40063813339a') }, /13 digits/],
      ['UPC-A wrong check digit', { card: generated('upca', '036000291453') }, /check digit/],
      ['EAN-8 wrong check digit', { card: generated('ean8', '96385075') }, /check digit/],
      ['EAN-8 trailing newline', { card: generated('ean8', '9638507\n') }, /8 digits/],
      ['Code 39 lower case', { card: generated('code39', 'abc') }, /cannot encode/],
      ['Code 128 non-ASCII', { card: generated('code128', 'café') }, /cannot encode/],
      ['Code 128 too long', { card: generated('code128', 'A'.repeat(81)) }, /longer than 80/],
      ['QR code too long', { card: generated('qrcode', 'q'.repeat(1001)) }, /longer than 1000/],
      ['PDF417 too long', { card: generated('pdf417', 'p'.repeat(501)) }, /longer than 500/],
      ['empty generated value', { card: generated('qrcode', '') }, /empty/],
      ['non-string generated value', { card: generated('qrcode', 5) }, /barcode value/],
      ['empty text value', { card: setBarcode({ kind: 'text', value: '' }) }, /barcode value/],
      ['non-string image type', { card: setBarcode({ kind: 'image', mimeType: ['image/png'], byteLength: 1, data: 'AA==' }) }, /image type/],
      ['unparseable createdAt', { card: (c) => void (c.createdAt = 'not a date') }, /timestamp/],
      ['impossible month in updatedAt', { card: (c) => void (c.updatedAt = '2026-13-01T00:00:00.000Z') }, /timestamp/],
      ['empty createdAt', { card: (c) => void (c.createdAt = '') }, /timestamp/],
      ['missing updatedAt', { card: (c) => void delete c.updatedAt }, /timestamp/],
      ['numeric createdAt', { card: (c) => void (c.createdAt = 1_772_359_200_000) }, /timestamp/],
      ['over-long createdAt', { card: (c) => void (c.createdAt = `2026-03-01T10:00:00.000Z${' '.repeat(41)}`) }, /timestamp/],
      ['store name blank after JS trim (U+FEFF)', { card: (c) => void (c.storeName = '﻿ ') }, /storeName/],
      ['store name too long', { card: (c) => void (c.storeName = 'S'.repeat(81)) }, /storeName/],
      ['unsupported schemaVersion', { card: (c) => void (c.schemaVersion = 3) }, /schemaVersion/],
      ['boolean schemaVersion', { card: (c) => void (c.schemaVersion = true) }, /schemaVersion/],
    ]
    it.each(sharedRejections)('rejects %s, as the app does, and writes nothing', async (label, edit, message) => {
      const text = await variant(edit)
      expect(() => parseBackup(text), label).toThrow()
      expectRejected(text, message, label)
    })

    // The app's parser does not check these (metadata is informational; Date.parse
    // is lenient in V8), but the script copies metadata into every part and must
    // not depend on one browser's parsing, so it is deliberately stricter.
    const stricterRejections: Array<[string, Parameters<typeof variant>[0], RegExp]> = [
      ['missing exportedAt', { doc: (d) => void delete d.exportedAt }, /exportedAt/],
      ['invalid exportedAt', { doc: (d) => void (d.exportedAt = 'yesterday') }, /exportedAt/],
      ['numeric exportedAt', { doc: (d) => void (d.exportedAt = 0) }, /exportedAt/],
      ['missing app metadata', { doc: (d) => void delete d.app }, /app metadata/],
      ['non-object app metadata', { doc: (d) => void (d.app = 'M8TRX') }, /app metadata/],
      ['empty app.name', { doc: (d) => void (d.app = { name: '', version: '0.5.0' }) }, /app\.name/],
      ['non-string app.version', { doc: (d) => void (d.app = { name: 'M8TRX', version: 5 }) }, /app\.version/],
      ['calendar-invalid date (Feb 30)', { card: (c) => void (c.createdAt = '2026-02-30T00:00:00.000Z') }, /timestamp/],
      ['non-ISO date form', { card: (c) => void (c.createdAt = '2026-03-01 10:00:00') }, /timestamp/],
    ]
    it.each(stricterRejections)('rejects %s (stricter than the app) and writes nothing', async (label, edit, message) => {
      expectRejected(await variant(edit), message, label)
    })

    it('accepts every tile colour, barcode format and ISO timestamp form, and the app restores every part', async () => {
      const colors = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'indigo', 'purple', 'pink', 'brown', 'slate', 'white']
      const barcodes: CardBarcode[] = [
        { kind: 'generated', format: 'code128', value: ' Sample 0001 !~ ' },
        { kind: 'generated', format: 'code39', value: 'ABC-123 $/+%.' },
        { kind: 'generated', format: 'ean13', value: '4006381333931' },
        { kind: 'generated', format: 'upca', value: '036000291452' },
        { kind: 'generated', format: 'ean8', value: '96385074' },
        { kind: 'generated', format: 'qrcode', value: `https://example.com/ü?${'q'.repeat(970)}` },
        { kind: 'generated', format: 'pdf417', value: 'P'.repeat(500) },
        { kind: 'generated', format: 'datamatrix', value: 'SAMPLE DM' },
        { kind: 'generated', format: 'azteccode', value: 'SAMPLE AZ' },
        { kind: 'text', value: '  0000 1111  ' },
        { kind: 'image', image: image(1, 300) },
      ]
      const timestamps = ['2026', '2026-03', '2026-03-01', '2026-03-01T10:00', '2026-03-01T10:00:59Z', '2026-03-01T10:00:00+05:30', '2026-12-31T23:59:59.999-08:00', '2024-02-29T00:00:00.000Z']
      const wallet = barcodes.map((barcode, i) =>
        card(`v${i}`, i === 0 ? `  Padded ${'N'.repeat(70)}  ` : `Store ${i}`, barcode, {
          color: colors[i % colors.length]!,
          createdAt: timestamps[i % timestamps.length]!,
          updatedAt: timestamps[(i + 3) % timestamps.length]!,
        }),
      )
      wallet.push(card('last', 'White tile', { kind: 'text', value: 'W' }, { color: 'white' }))
      // Every category icon, on cards spread across parts; the rest keep None.
      CARD_ICON_IDS.forEach((icon, i) => {
        wallet[i] = { ...wallet[i]!, icon }
      })
      const text = await createBackup(wallet, meta)
      expect(parseBackup(text)).toHaveLength(wallet.length) // the app accepts the input

      const result = runSplit(writeBackup(text), '--max-cards', '5')
      expect(result.stderr).toBe('')
      expect(result.status).toBe(0)
      const original = JSON.parse(text) as Doc
      const byId = new Map(original.cards.map((c) => [c.id, c]))
      const restored: string[] = []
      for (const name of parts()) {
        const partText = readPart(name)
        const part = JSON.parse(partText) as Doc
        for (const record of part.cards) expect(record).toEqual(byId.get(record.id))
        restored.push(...parseBackup(partText).map((c) => c.id))
      }
      expect(restored).toEqual(original.order)
      // Icons survive splitting and restore; cards without one stay None.
      const restoredIcons = new Map<string, string | undefined>()
      for (const name of parts()) for (const c of parseBackup(readPart(name))) restoredIcons.set(c.id, c.icon)
      expect(wallet.map((c) => restoredIcons.get(c.id))).toEqual(wallet.map((c) => c.icon))
      expect(original.cards.filter((c) => !('icon' in c)).length).toBe(wallet.length - CARD_ICON_IDS.length)
    })

    it('removes the parts it already wrote if writing a later part fails', async () => {
      const input = writeBackup(await createBackup([card('a', 'A', { kind: 'text', value: '1' }), card('b', 'B', { kind: 'text', value: '2' })], meta))
      // Load the script as a module and make the second part's write fail (as a full disk would).
      const probe = [
        'import builtins, importlib.util, os, sys',
        'spec = importlib.util.spec_from_file_location("splitter", sys.argv[1])',
        'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
        'real_open = builtins.open; count = [0]',
        'def failing_open(path, mode="r", *a, **k):',
        '    if mode == "xb":',
        '        count[0] += 1',
        '        if count[0] == 2: raise OSError(28, "No space left on device")',
        '    return real_open(path, mode, *a, **k)',
        'builtins.open = failing_open',
        'limits = dict(m.LIMITS); limits["cards"] = 1',
        'try:',
        '    m.run(sys.argv[2], sys.argv[3], limits); print("no error")',
        'except OSError as e: print("failed:", e.strerror)',
      ].join('\n')
      const out = execFileSync('python3', ['-I', '-c', probe, SCRIPT, input, dir], { encoding: 'utf-8' })
      expect(out.trim()).toBe('failed: No space left on device')
      expect(parts()).toEqual([])
    })
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
