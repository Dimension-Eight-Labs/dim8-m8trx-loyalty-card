/**
 * Barcode encoding/decoding tests. These run the real bwip-js encoders and the
 * real ZXing decoder (no mocks) on host Node/jsdom. They prove the stored
 * value survives redraw → rasterize → decode exactly; they do not prove that
 * a retail scanner reads a phone screen.
 */
import { describe, expect, it } from 'vitest'
import {
  binarizeOtsu,
  cropBitmap,
  downscaleBitmap,
  invertBitmap,
  luminanceRange,
  rotate90,
  stretchContrast,
} from './bitmapTransforms.ts'
import { decodeBitmap, PRIORITY_FORMATS, rgbaToGrey } from './decode.ts'
import { decodeWithCascade, IMAGE_CASCADE } from './decodeCascade.ts'
import { code128PatchStatus } from './zxingPatches.ts'
import { BARCODE_FORMATS, gs1CheckDigit, validateBarcodeValue, type BarcodeFormat } from './formats.ts'
import { createBitmapDrawing, type GreyBitmap } from './rasterize.ts'
import { BarcodeRenderError, renderBarcodeSvg, renderWith } from './render.ts'
import { verifyRoundTrip } from './verify.ts'

/** Representative values, deliberately including leading zeros and spaces. */
const SAMPLES: Record<BarcodeFormat, string> = {
  code128: '0012 3456-ab',
  code39: '00ABC-12 3',
  ean13: '0012345678905',
  upca: '012345678905',
  ean8: '00123457',
  qrcode: 'https://example.com/card?id=000123',
  pdf417: '000123 LOYALTY member',
  datamatrix: '0001234 member',
  azteccode: '0009876 member',
}

function draw(format: BarcodeFormat, value: string, scale = 3): GreyBitmap {
  return renderWith(format, value, createBitmapDrawing(), { scale, includeText: false })
}

describe('barcode round trip (bwip-js → rasterize → ZXing)', () => {
  it.each(BARCODE_FORMATS)('%s preserves the exact value and symbology', (format) => {
    const value = SAMPLES[format]
    expect(validateBarcodeValue(format, value)).toBeNull()
    expect(decodeBitmap(draw(format, value), { formats: [format], tryHarder: true })).toEqual({
      status: 'decoded',
      format,
      value,
    })
    expect(verifyRoundTrip(format, value)).toEqual({ ok: true })
  })

  it('reports the original symbology when decoding with every format enabled', () => {
    for (const format of ['code128', 'code39', 'upca', 'ean8', 'qrcode', 'pdf417', 'datamatrix', 'azteccode'] as const) {
      const result = decodeBitmap(draw(format, SAMPLES[format]), { tryHarder: true })
      expect(result).toEqual({ status: 'decoded', format, value: SAMPLES[format] })
    }
    // An EAN-13 that does not start with 0 is unambiguous.
    expect(decodeBitmap(draw('ean13', '4006381333931'), { tryHarder: true })).toEqual({
      status: 'decoded',
      format: 'ean13',
      value: '4006381333931',
    })
  })

  it('keeps an all-digit Code 128 value as text, leading zeros included', () => {
    expect(decodeBitmap(draw('code128', '000000123'), { tryHarder: true })).toEqual({
      status: 'decoded',
      format: 'code128',
      value: '000000123',
    })
  })

  it('reads a UPC-A symbol as UPC-A even though it is a zero-prefixed EAN-13', () => {
    // Documented ZXing behaviour: the bars are identical either way.
    const result = decodeBitmap(draw('ean13', '0012345678905'), { tryHarder: true })
    expect(result).toEqual({ status: 'decoded', format: 'upca', value: '012345678905' })
  })

  it('returns not-found for a blank image', () => {
    const blank = { width: 200, height: 100, data: new Uint8ClampedArray(200 * 100).fill(255) }
    expect(decodeBitmap(blank, { tryHarder: true })).toEqual({ status: 'not-found' })
  })
})

describe('rendering', () => {
  it('produces SVG with a white background', () => {
    const svg = renderBarcodeSvg('code128', '0012')
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg).toMatch(/FFFFFF|#ffffff/i)
  })

  it('surrounds linear codes with at least a 10-module quiet zone', () => {
    const bitmap = draw('code128', '0012', 1)
    const row = Array.from(bitmap.data.subarray(bitmap.width * 10, bitmap.width * 11))
    const firstBlack = row.indexOf(0)
    const lastBlack = row.lastIndexOf(0)
    expect(firstBlack).toBeGreaterThanOrEqual(10)
    expect(bitmap.width - 1 - lastBlack).toBeGreaterThanOrEqual(10)
  })

  it('surrounds QR codes with at least a 4-module quiet zone', () => {
    const bitmap = draw('qrcode', 'A', 1)
    const firstBlackPixel = bitmap.data.indexOf(0)
    const x = firstBlackPixel % bitmap.width
    const y = Math.floor(firstBlackPixel / bitmap.width)
    // A QR module is 2 px at scale 1.
    expect(x).toBeGreaterThanOrEqual(8)
    expect(y).toBeGreaterThanOrEqual(8)
  })

  it('throws a friendly BarcodeRenderError for an invalid check digit', () => {
    expect(() => renderBarcodeSvg('ean13', '0012345678901')).toThrow(BarcodeRenderError)
  })
})

describe('validation', () => {
  it('computes GS1 check digits', () => {
    expect(gs1CheckDigit('001234567890')).toBe(5)
    expect(gs1CheckDigit('01234567890')).toBe(5)
    expect(gs1CheckDigit('0012345')).toBe(7)
  })

  it.each([
    ['ean13', '0012345678901', /check digit/],
    ['ean13', '001234567890', /exactly 13/],
    ['ean13', '00123456789O5', /digits only/],
    ['upca', '012345678901', /check digit/],
    ['upca', '12345678905', /exactly 12/],
    ['ean8', '00123456', /check digit/],
    ['code39', 'abc', /lower-case/],
    ['code39', 'A_B', /supports digits/],
    ['code128', 'Café', /ASCII/],
    ['qrcode', '', /Enter/],
    ['qrcode', 'x'.repeat(1001), /too long/],
  ] as const)('%s rejects %j', (format, value, message) => {
    expect(validateBarcodeValue(format, value)).toMatch(message)
  })

  it('never rewrites the value: whitespace is significant', () => {
    expect(validateBarcodeValue('code128', ' 0012 ')).toBeNull()
    expect(verifyRoundTrip('code128', ' 0012 ')).toEqual({ ok: true })
  })

  it('fails verification instead of substituting when a value cannot be drawn', () => {
    expect(verifyRoundTrip('ean13', '0012345678901')).toMatchObject({ ok: false })
  })
})

describe('rgbaToGrey', () => {
  it('converts opaque pixels by luma and transparent pixels to white', () => {
    const rgba = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 0])
    expect(Array.from(rgbaToGrey(rgba, 3, 1).data)).toEqual([0, 255, 255])
  })
})

describe('human-readable text', () => {
  it('uses the standard EAN/UPC digit layout and centres free-text codes', async () => {
    const { buildRenderOptions } = await import('./render.ts')
    expect(buildRenderOptions('ean13', '4006381333931').textxalign).toBeUndefined()
    expect(buildRenderOptions('upca', '012345678905').textxalign).toBeUndefined()
    expect(buildRenderOptions('code128', 'A').textxalign).toBe('center')
    expect(buildRenderOptions('qrcode', 'A').includetext).toBeUndefined()
  })
})

/** Places `code` on a canvas of `fill`, with optional dark blocks left of it on the same rows. */
function embed(code: GreyBitmap, options: { pad?: number; fill?: number; darkLeft?: boolean } = {}): GreyBitmap {
  const pad = options.pad ?? 80
  const width = code.width + pad * 2
  const height = code.height + pad * 2
  const data = new Uint8ClampedArray(width * height).fill(options.fill ?? 255)
  for (let y = 0; y < code.height; y++) data.set(code.data.subarray(y * code.width, (y + 1) * code.width), (y + pad) * width + pad)
  if (options.darkLeft) for (let y = pad; y < pad + code.height; y++) data.fill(0, y * width + 4, y * width + pad - 40)
  return { width, height, data }
}

/** Maps luminance into [low, high] (simulates a washed-out screenshot or dim photo). */
function compress(bitmap: GreyBitmap, low: number, high: number): GreyBitmap {
  const data = new Uint8ClampedArray(bitmap.data.length)
  for (let i = 0; i < data.length; i++) data[i] = low + ((bitmap.data[i] ?? 0) * (high - low)) / 255
  return { width: bitmap.width, height: bitmap.height, data }
}

/** Nearest-neighbour enlargement (simulates a high-resolution screenshot). */
function enlarge(bitmap: GreyBitmap, factor: number): GreyBitmap {
  const width = bitmap.width * factor
  const height = bitmap.height * factor
  const data = new Uint8ClampedArray(width * height)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data[y * width + x] = bitmap.data[Math.floor(y / factor) * bitmap.width + Math.floor(x / factor)]!
  return { width, height, data }
}

describe('Code 128 start-pattern fix (@zxing/library 0.23.0 defect)', () => {
  it('is installed', () => {
    expect(code128PatchStatus).toBe('applied')
  })

  it('reads Code 128 when dark pixels precede it on the same rows, as in every camera frame', () => {
    // Unpatched ZXing returns not-found (or a checksum failure) here.
    const scene = embed(draw('code128', '0012 3456-ab', 2), { darkLeft: true })
    expect(decodeBitmap(scene)).toEqual({ status: 'decoded', format: 'code128', value: '0012 3456-ab' })
    expect(decodeBitmap(embed(draw('code128', '000000123', 2), { fill: 120 }), { formats: PRIORITY_FORMATS })).toEqual({
      status: 'decoded',
      format: 'code128',
      value: '000000123',
    })
  })
})

describe('automatic format recognition', () => {
  it.each(['qrcode', 'code128', 'code39', 'upca', 'ean13'] as const)(
    'recognises %s with the live-scan priority set, keeping value and symbology exact',
    (format) => {
      const value = format === 'ean13' ? '4006381333931' : SAMPLES[format]
      const scene = embed(draw(format, value, 3), { darkLeft: format !== 'qrcode' })
      expect(decodeBitmap(scene, { formats: PRIORITY_FORMATS })).toEqual({ status: 'decoded', format, value })
    },
  )

  it('leaves 2D formats outside the priority set to the full-format pass', () => {
    const pdf = draw('pdf417', SAMPLES.pdf417)
    expect(decodeBitmap(pdf, { formats: PRIORITY_FORMATS })).toEqual({ status: 'not-found' })
    expect(decodeBitmap(pdf, { tryHarder: true })).toEqual({ status: 'decoded', format: 'pdf417', value: SAMPLES.pdf417 })
  })

  it('classifies malformed input as a decoder error instead of hanging or throwing', () => {
    expect(decodeBitmap({ width: 100, height: 100, data: new Uint8ClampedArray(10) })).toEqual({
      status: 'not-found',
      reason: 'decoder-error',
    })
    expect(decodeBitmap({ width: 0, height: 0, data: new Uint8ClampedArray(0) })).toMatchObject({ reason: 'decoder-error' })
  })

  it('does not tag ordinary misses as decoder errors', () => {
    const plain = { width: 50, height: 50, data: new Uint8ClampedArray(2500).fill(200) }
    expect(decodeBitmap(plain)).toEqual({ status: 'not-found' })
  })
})

describe('bitmap transforms', () => {
  const sample: GreyBitmap = { width: 3, height: 2, data: new Uint8ClampedArray([1, 2, 3, 4, 5, 6]) }

  it('rotates 90° clockwise', () => {
    expect(rotate90(sample)).toEqual({ width: 2, height: 3, data: new Uint8ClampedArray([4, 1, 5, 2, 6, 3]) })
    expect(rotate90(rotate90(rotate90(rotate90(sample))))).toEqual(sample)
  })

  it('crops with clamping', () => {
    expect(cropBitmap(sample, { x: 1, y: 1, width: 10, height: 10 })).toEqual({ width: 2, height: 1, data: new Uint8ClampedArray([5, 6]) })
  })

  it('downscales by box-averaging and never upscales', () => {
    const four: GreyBitmap = { width: 4, height: 2, data: new Uint8ClampedArray([0, 100, 200, 200, 100, 200, 200, 200]) }
    expect(downscaleBitmap(four, 2)).toEqual({ width: 2, height: 1, data: new Uint8ClampedArray([100, 200]) })
    expect(downscaleBitmap(sample, 1000)).toEqual(sample)
  })

  it('stretches contrast, thresholds, and inverts', () => {
    const dull: GreyBitmap = { width: 4, height: 1, data: new Uint8ClampedArray([100, 110, 130, 140]) }
    const stretched = stretchContrast(dull)
    expect(luminanceRange(stretched)).toEqual({ min: 0, max: 255 })
    expect(Array.from(binarizeOtsu(dull).data)).toEqual([0, 0, 255, 255])
    expect(Array.from(invertBitmap(dull).data)).toEqual([155, 145, 125, 115])
  })

  it('never modifies the source bitmap', () => {
    const source = embed(draw('upca', SAMPLES.upca, 2))
    const before = source.data.slice()
    for (const transform of [rotate90, invertBitmap, stretchContrast, binarizeOtsu, (b: GreyBitmap) => downscaleBitmap(b, 100)]) {
      transform(source)
    }
    expect(source.data).toEqual(before)
  })
})

describe('still-image decode cascade', () => {
  const noPause = { pause: async () => undefined }

  it('decodes a clean image on the first step', async () => {
    const outcome = await decodeWithCascade(embed(draw('ean13', '4006381333931')), noPause)
    expect(outcome).toMatchObject({ step: 'original', attempts: 1, result: { status: 'decoded', format: 'ean13', value: '4006381333931' } })
  })

  it('decodes a barcode shown sideways via rotation, preserving leading zeros', async () => {
    const sideways = rotate90(embed(draw('code128', '000000123', 2), { darkLeft: true }))
    expect(decodeBitmap(sideways, { tryHarder: true })).toEqual({ status: 'not-found' })
    const outcome = await decodeWithCascade(sideways, noPause)
    expect(outcome.result).toEqual({ status: 'decoded', format: 'code128', value: '000000123' })
    expect(outcome.step).toMatch(/rotated/)
  })

  it('decodes a light-on-dark (dark mode) code via inversion', async () => {
    const dark = invertBitmap(embed(draw('code39', SAMPLES.code39, 2)))
    const outcome = await decodeWithCascade(dark, noPause)
    expect(outcome.result).toEqual({ status: 'decoded', format: 'code39', value: SAMPLES.code39 })
  })

  it('decodes a very low-contrast image', async () => {
    const faint = compress(embed(draw('upca', SAMPLES.upca, 2)), 150, 175)
    const outcome = await decodeWithCascade(faint, noPause)
    expect(outcome.result).toEqual({ status: 'decoded', format: 'upca', value: SAMPLES.upca })
  })

  it('decodes an enlarged screenshot-sized image', async () => {
    const big = enlarge(embed(draw('qrcode', SAMPLES.qrcode, 2)), 6)
    const outcome = await decodeWithCascade(big, noPause)
    expect(outcome.result).toEqual({ status: 'decoded', format: 'qrcode', value: SAMPLES.qrcode })
  })

  it('stops after the time budget and reports not-found', async () => {
    let clock = 0
    const blank: GreyBitmap = { width: 400, height: 300, data: new Uint8ClampedArray(400 * 300).fill(255) }
    const outcome = await decodeWithCascade(blank, { ...noPause, budgetMs: 50, now: () => (clock += 30) })
    expect(outcome).toMatchObject({ result: { status: 'not-found' }, timedOut: true })
    expect(outcome.attempts).toBeLessThan(IMAGE_CASCADE.length)
  })

  it('tries every applicable step when nothing is found, without modifying the source', async () => {
    const blank: GreyBitmap = { width: 900, height: 600, data: new Uint8ClampedArray(900 * 600).fill(240) }
    const before = blank.data.slice()
    const outcome = await decodeWithCascade(blank, noPause)
    // Skipped as too small for a 900 px image: qr-quarter and qr-sixth (below
    // the 300 px sweep minimum) and quarter-size (below the 400 px minimum).
    expect(outcome).toMatchObject({ result: { status: 'not-found' }, timedOut: false, attempts: IMAGE_CASCADE.length - 3 })
    expect(blank.data).toEqual(before)
  })
})
