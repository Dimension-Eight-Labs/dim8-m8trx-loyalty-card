/**
 * Redraw-and-decode check run before a generated barcode is saved.
 *
 * The app redraws the value with the same bwip-js encoder used at checkout,
 * rasterizes it in memory, and decodes it again with ZXing restricted to the
 * same format. A pass means the drawing encodes exactly the stored value in
 * the stored symbology.
 *
 * A pass is NOT proof that a particular checkout scanner will accept the
 * on-screen code (screen glare, brightness, scanner type, and store systems
 * all matter); the UI words it accordingly.
 */
import { decodeBitmap } from './decode.ts'
import type { BarcodeFormat } from './formats.ts'
import { createBitmapDrawing } from './rasterize.ts'
import { renderWith } from './render.ts'

export type VerifyResult = { ok: true } | { ok: false; reason: string }

export function verifyRoundTrip(format: BarcodeFormat, value: string): VerifyResult {
  let bitmap
  try {
    // Scale 3 gives ZXing comfortably wide modules; text is irrelevant here.
    bitmap = renderWith(format, value, createBitmapDrawing(), { scale: 3, includeText: false })
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'This barcode can’t be drawn.' }
  }
  const decoded = decodeBitmap(bitmap, { formats: [format], tryHarder: true })
  if (decoded.status === 'decoded' && decoded.format === format && decoded.value === value) return { ok: true }
  return { ok: false, reason: 'The redrawn barcode didn’t read back as the same value.' }
}
