/**
 * Barcode format registry: the single source of truth for every symbology the
 * app can store, validate, redraw, and decode.
 *
 * Why one registry: decoding (ZXing), rendering (bwip-js), validation, labels,
 * and quiet zones must agree about each format. Keeping them in one table
 * means a format is either fully supported end to end or not offered at all,
 * and the app can never silently substitute one symbology for another.
 *
 * Technology-neutral: this file names library identifiers as plain strings
 * but imports neither library, so the domain model and UI can use it without
 * pulling the (large) encoders into the main bundle.
 *
 * Values are always strings. Nothing here trims, pads, upper-cases, or
 * otherwise rewrites a value; validation only accepts or rejects it.
 */

export const BARCODE_FORMATS = [
  'code128',
  'code39',
  'ean13',
  'upca',
  'ean8',
  'qrcode',
  'pdf417',
  'datamatrix',
  'azteccode',
] as const

export type BarcodeFormat = (typeof BARCODE_FORMATS)[number]

export interface BarcodeFormatSpec {
  /** Human-readable name shown in the manual-entry picker. */
  label: string
  /** Short hint about what the format accepts. */
  hint: string
  /** Linear (1D) codes are drawn wide and short; 2D codes square-ish. */
  dimension: '1d' | '2d'
  /** bwip-js encoder id (also the BWIPP routine name). */
  bwipId: string
  /** ZXing `BarcodeFormat` enum key that decodes this symbology. */
  zxingName: string
  /**
   * Quiet zone in modules on each side. Values meet or exceed the symbology
   * specifications (Code 128/39: 10X, EAN/UPC: 11X/9X, QR: 4, PDF417: 2,
   * Data Matrix: 1, Aztec: none required). The checkout surface adds more
   * white margin around the image, so these are a floor, not the total.
   */
  quietZone: number
  /** Whether bwip-js should print the human-readable digits under the bars. */
  humanReadable: boolean
  /** Maximum accepted value length (characters). */
  maxLength: number
  /** Returns a user-facing error, or null when the value is acceptable. */
  validate: (value: string) => string | null
}

const DIGITS = /^[0-9]+$/
/** Code 39 (non-extended) character set: digits, upper-case letters, and - . space $ / + % */
const CODE39_CHARS = /^[0-9A-Z \-.$/+%]+$/
/** Code 128 encodes ASCII 0–127 directly (code sets A/B/C). */
const ASCII = /^[\x00-\x7f]+$/ // eslint-disable-line no-control-regex

/**
 * GS1 mod-10 check digit used by EAN-13, UPC-A and EAN-8. `body` excludes the
 * check digit. Weights alternate 3,1,3… starting from the rightmost body digit.
 */
export function gs1CheckDigit(body: string): number {
  let sum = 0
  for (let i = 0; i < body.length; i++) {
    const digit = body.charCodeAt(body.length - 1 - i) - 48
    sum += digit * (i % 2 === 0 ? 3 : 1)
  }
  return (10 - (sum % 10)) % 10
}

function validateGs1(value: string, length: number, name: string): string | null {
  if (!DIGITS.test(value)) return `${name} uses digits only.`
  if (value.length !== length) return `${name} needs exactly ${length} digits, including the check digit.`
  const expected = gs1CheckDigit(value.slice(0, -1))
  if (Number(value[value.length - 1]) !== expected) {
    return `The last digit is a check digit and doesn’t match. Check the number for typos.`
  }
  return null
}

function nonEmptyWithin(max: number) {
  return (value: string): string | null => {
    if (value.length > max) return `That’s too long for this format (maximum ${max} characters).`
    return null
  }
}

export const FORMAT_SPECS: Record<BarcodeFormat, BarcodeFormatSpec> = {
  code128: {
    label: 'Code 128',
    hint: 'Letters, digits and symbols. The most common loyalty-card barcode.',
    dimension: '1d',
    bwipId: 'code128',
    zxingName: 'CODE_128',
    quietZone: 12,
    humanReadable: true,
    maxLength: 80,
    validate: (value) => {
      if (!ASCII.test(value)) return 'Code 128 supports standard (ASCII) characters only.'
      return nonEmptyWithin(80)(value)
    },
  },
  code39: {
    label: 'Code 39',
    hint: 'Digits, capital letters, space and - . $ / + %',
    dimension: '1d',
    bwipId: 'code39',
    zxingName: 'CODE_39',
    quietZone: 12,
    humanReadable: true,
    maxLength: 60,
    validate: (value) => {
      if (!CODE39_CHARS.test(value)) {
        return /[a-z]/.test(value)
          ? 'Code 39 has no lower-case letters. Use capitals if that’s what the card shows.'
          : 'Code 39 supports digits, capital letters, space and - . $ / + % only.'
      }
      return nonEmptyWithin(60)(value)
    },
  },
  ean13: {
    label: 'EAN-13',
    hint: '13 digits, the last one a check digit.',
    dimension: '1d',
    bwipId: 'ean13',
    zxingName: 'EAN_13',
    quietZone: 12,
    humanReadable: true,
    maxLength: 13,
    validate: (value) => validateGs1(value, 13, 'EAN-13'),
  },
  upca: {
    label: 'UPC-A',
    hint: '12 digits, the last one a check digit.',
    dimension: '1d',
    bwipId: 'upca',
    zxingName: 'UPC_A',
    quietZone: 12,
    humanReadable: true,
    maxLength: 12,
    validate: (value) => validateGs1(value, 12, 'UPC-A'),
  },
  ean8: {
    label: 'EAN-8',
    hint: '8 digits, the last one a check digit.',
    dimension: '1d',
    bwipId: 'ean8',
    zxingName: 'EAN_8',
    quietZone: 12,
    humanReadable: true,
    maxLength: 8,
    validate: (value) => validateGs1(value, 8, 'EAN-8'),
  },
  qrcode: {
    label: 'QR code',
    hint: 'Any text.',
    dimension: '2d',
    bwipId: 'qrcode',
    zxingName: 'QR_CODE',
    quietZone: 4,
    humanReadable: false,
    maxLength: 1000,
    validate: nonEmptyWithin(1000),
  },
  pdf417: {
    label: 'PDF417',
    hint: 'Any text. Wide, stacked barcode.',
    dimension: '2d',
    bwipId: 'pdf417',
    zxingName: 'PDF_417',
    quietZone: 3,
    humanReadable: false,
    maxLength: 500,
    validate: nonEmptyWithin(500),
  },
  datamatrix: {
    label: 'Data Matrix',
    hint: 'Any text. Small square code.',
    dimension: '2d',
    bwipId: 'datamatrix',
    zxingName: 'DATA_MATRIX',
    quietZone: 3,
    humanReadable: false,
    maxLength: 500,
    validate: nonEmptyWithin(500),
  },
  azteccode: {
    label: 'Aztec',
    hint: 'Any text. Square code with a bullseye center.',
    dimension: '2d',
    bwipId: 'azteccode',
    zxingName: 'AZTEC',
    quietZone: 3,
    humanReadable: false,
    maxLength: 500,
    validate: nonEmptyWithin(500),
  },
}

export function isBarcodeFormat(value: unknown): value is BarcodeFormat {
  return typeof value === 'string' && (BARCODE_FORMATS as readonly string[]).includes(value)
}

/**
 * Validates `value` for `format` exactly as given. Empty values are rejected
 * here; callers must not trim or otherwise normalize barcode data first,
 * because whitespace can be meaningful in Code 128 and 2D codes.
 */
export function validateBarcodeValue(format: BarcodeFormat, value: string): string | null {
  if (value.length === 0) return 'Enter the barcode value.'
  return FORMAT_SPECS[format].validate(value)
}

/** Maps a ZXing format name to ours; undefined for symbologies we can't redraw. */
export function formatFromZxingName(name: string): BarcodeFormat | undefined {
  return BARCODE_FORMATS.find((format) => FORMAT_SPECS[format].zxingName === name)
}

/** Friendly names for ZXing formats we can detect but deliberately do not redraw. */
export const UNSUPPORTED_ZXING_LABELS: Record<string, string> = {
  CODABAR: 'Codabar',
  CODE_93: 'Code 93',
  ITF: 'Interleaved 2 of 5',
  UPC_E: 'UPC-E',
  RSS_14: 'GS1 DataBar',
  RSS_EXPANDED: 'GS1 DataBar Expanded',
  MAXICODE: 'MaxiCode',
}
