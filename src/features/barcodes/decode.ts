/**
 * Barcode decoding with ZXing (@zxing/library, pure JavaScript).
 *
 * Input is a greyscale bitmap, so the same decoder serves camera frames,
 * imported images, cropped retries, and the redraw round-trip check. Pixel
 * acquisition (video, canvas, image files) lives in imageSource.ts.
 *
 * Why ZXing rather than the native BarcodeDetector API: BarcodeDetector is
 * missing from Safari/iOS and Firefox, and its format names differ per
 * platform. One decoder everywhere gives one consistent symbology mapping.
 *
 * Exactness: the decoded text is returned untouched (leading zeros, spaces,
 * and case preserved) together with the symbology ZXing reports. Formats we
 * can detect but not redraw are reported as `unsupported` with their name and
 * value, so the UI can explain instead of guessing another format.
 *
 * Known ZXing behaviour: a UPC-A symbol is physically an EAN-13 symbol whose
 * first digit is 0. When both formats are enabled, ZXing reports such codes
 * as UPC-A (12 digits). Either way the redrawn bars are identical.
 *
 * Library defect: @zxing/library 0.23.0 cannot find the Code 128 start symbol
 * when anything dark precedes it on the scanned row; zxingPatches.ts corrects
 * this and is installed by importing it here, before any decode runs.
 *
 * Performance: MultiFormatReader instances are cached per (formats, tryHarder)
 * combination and reused with decodeWithState(). Building a reader allocates
 * every sub-reader (and logs a console warning for the experimental GS1
 * DataBar Expanded reader), which previously happened on every camera frame.
 */
import {
  BarcodeFormat as ZxingFormat,
  BinaryBitmap,
  ChecksumException,
  DecodeHintType,
  FormatException,
  HybridBinarizer,
  MultiFormatReader,
  NotFoundException,
  RGBLuminanceSource,
} from '@zxing/library'
import './zxingPatches.ts'
import { BARCODE_FORMATS, FORMAT_SPECS, formatFromZxingName, UNSUPPORTED_ZXING_LABELS, type BarcodeFormat } from './formats.ts'
import type { GreyBitmap } from './rasterize.ts'

export type DecodeResult =
  | { status: 'decoded'; format: BarcodeFormat; value: string }
  | { status: 'unsupported'; formatLabel: string; value: string }
  /**
   * `reason` is present only when the decoder threw something other than its
   * normal "nothing readable here" exceptions. It carries no image content
   * and exists so diagnostics can tell "no barcode" from "decoder failure".
   */
  | { status: 'not-found'; reason?: 'decoder-error' }

/**
 * Formats tried on most live camera frames, in the order the task prioritises
 * (QR, Code 128, Code 39, UPC-A, EAN-13; EAN-8 is nearly free alongside the
 * other EAN/UPC codes). Restricting the set keeps each frame fast; the camera
 * loop periodically runs the full set so PDF417/Data Matrix/Aztec and
 * detect-only formats are still recognised automatically.
 */
export const PRIORITY_FORMATS: readonly BarcodeFormat[] = ['qrcode', 'code128', 'code39', 'upca', 'ean13', 'ean8']

export interface DecodeOptions {
  /** Restrict decoding to these formats (default: every supported format). */
  formats?: readonly BarcodeFormat[]
  /**
   * Spend more time per image (rotations, denser sampling). Worth it for a
   * single imported image; too slow for every camera frame.
   */
  tryHarder?: boolean
}

/**
 * ZXing formats we also listen for, purely to explain that they're
 * unsupported. MaxiCode is excluded: ZXing's MaxiCode reader only handles
 * perfectly aligned "pure" images, never matches camera frames or
 * screenshots in practice, and throws internal errors on ordinary pictures
 * (each logged as a console warning by MultiFormatReader).
 */
const DETECT_ONLY = Object.keys(UNSUPPORTED_ZXING_LABELS).filter((name) => name !== 'MAXICODE')

function zxingFormat(name: string): ZxingFormat {
  return ZxingFormat[name as keyof typeof ZxingFormat]
}

/**
 * Decodes the first barcode found in `bitmap`. Never throws: "nothing found"
 * and unexpected decoder errors are both reported as not-found (the latter
 * tagged with `reason: 'decoder-error'`). The input bitmap is not modified.
 */
export function decodeBitmap(bitmap: GreyBitmap, options: DecodeOptions = {}): DecodeResult {
  // Malformed bitmaps (zero/negative size, too little data) can send ZXing
  // into very long or endless loops, so they are rejected up front.
  if (
    !Number.isInteger(bitmap.width) ||
    !Number.isInteger(bitmap.height) ||
    bitmap.width < 1 ||
    bitmap.height < 1 ||
    bitmap.data.length < bitmap.width * bitmap.height
  ) {
    return { status: 'not-found', reason: 'decoder-error' }
  }
  const allowed = options.formats ?? BARCODE_FORMATS
  const reader = readerFor(allowed, !options.formats, options.tryHarder === true)
  try {
    const source = new RGBLuminanceSource(bitmap.data, bitmap.width, bitmap.height)
    const result = reader.decodeWithState(new BinaryBitmap(new HybridBinarizer(source)))
    let name = ZxingFormat[result.getBarcodeFormat()]
    let value = result.getText()
    // ZXing reports a zero-prefixed EAN-13 as UPC-A even when only EAN-13 was
    // requested. The bars are identical, so restoring the leading 0 is exact.
    if (name === 'UPC_A' && !allowed.includes('upca') && allowed.includes('ean13')) {
      name = 'EAN_13'
      value = `0${value}`
    }
    const format = formatFromZxingName(name)
    if (format && allowed.includes(format)) return { status: 'decoded', format, value }
    return { status: 'unsupported', formatLabel: UNSUPPORTED_ZXING_LABELS[name] ?? name, value }
  } catch (error) {
    // NotFound, Checksum and Format exceptions all mean "no reliable read".
    if (error instanceof NotFoundException || error instanceof ChecksumException || error instanceof FormatException) {
      return { status: 'not-found' }
    }
    // Anything else is a decoder fault. To the user the outcome is the same
    // (try again, crop, or enter manually), but diagnostics count it.
    return { status: 'not-found', reason: 'decoder-error' }
  } finally {
    reader.reset()
  }
}

const readerCache = new Map<string, MultiFormatReader>()

/** Returns a cached reader configured for this format set (bounded: one per distinct option combination). */
function readerFor(allowed: readonly BarcodeFormat[], includeDetectOnly: boolean, tryHarder: boolean): MultiFormatReader {
  const names = allowed.map((format) => FORMAT_SPECS[format].zxingName)
  if (includeDetectOnly) names.push(...DETECT_ONLY)
  const key = `${names.join(',')}|${tryHarder ? 'hard' : 'fast'}`
  let reader = readerCache.get(key)
  if (!reader) {
    const hints = new Map<DecodeHintType, unknown>()
    hints.set(DecodeHintType.POSSIBLE_FORMATS, names.map(zxingFormat))
    if (tryHarder) hints.set(DecodeHintType.TRY_HARDER, true)
    reader = new MultiFormatReader()
    reader.setHints(hints)
    readerCache.set(key, reader)
  }
  return reader
}

/**
 * Converts RGBA pixels (e.g. canvas ImageData) to greyscale using integer
 * Rec. 601 luma weights. Transparent pixels are treated as white, because
 * screenshots with transparency are normally drawn on a light background.
 */
export function rgbaToGrey(rgba: Uint8ClampedArray, width: number, height: number): GreyBitmap {
  const data = new Uint8ClampedArray(width * height)
  for (let i = 0, p = 0; p < data.length; i += 4, p++) {
    const alpha = rgba[i + 3] ?? 255
    const luma = ((rgba[i] ?? 255) * 299 + (rgba[i + 1] ?? 255) * 587 + (rgba[i + 2] ?? 255) * 114) / 1000
    data[p] = alpha === 255 ? luma : (luma * alpha + 255 * (255 - alpha)) / 255
  }
  return { width, height, data }
}
