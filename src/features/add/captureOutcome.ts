/**
 * Turns a decode result into what the add flow should do next. Shared by the
 * camera and import paths so both explain failures the same way.
 *
 * A decoded barcode is accepted only if the redraw round-trip check passes;
 * otherwise the detected format/value are returned for the image fallback.
 */
import type { CardBarcode } from '../cards/card.ts'
import { FORMAT_SPECS } from '../barcodes/formats.ts'
import type { DecodeResult, VerifyResult } from './captureServices.ts'
import type { BarcodeFormat } from '../barcodes/formats.ts'

export type CaptureOutcome =
  | { ok: true; barcode: CardBarcode }
  | { ok: false; message: string; detected?: { formatLabel: string; value: string } }

export function outcomeFromDecode(
  result: DecodeResult,
  verify: (format: BarcodeFormat, value: string) => VerifyResult,
): CaptureOutcome {
  switch (result.status) {
    case 'decoded': {
      const check = verify(result.format, result.value)
      if (check.ok) return { ok: true, barcode: { kind: 'generated', format: result.format, value: result.value } }
      const formatLabel = FORMAT_SPECS[result.format].label
      return {
        ok: false,
        message: `Found a ${formatLabel} barcode, but it couldn’t be redrawn exactly.`,
        detected: { formatLabel, value: result.value },
      }
    }
    case 'unsupported':
      return {
        ok: false,
        message: `Found a ${result.formatLabel} barcode, which this app can’t redraw.`,
        detected: { formatLabel: result.formatLabel, value: result.value },
      }
    case 'not-found':
      return { ok: false, message: 'No barcode was found.' }
  }
}
