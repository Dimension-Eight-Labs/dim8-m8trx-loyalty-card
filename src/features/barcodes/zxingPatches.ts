/**
 * Runtime correction for a defect in @zxing/library 0.23.0 (the current
 * release when this was written) that makes Code 128 fail on camera frames.
 *
 * The defect: `Code128Reader.findStartPattern` slides a 6-run window along a
 * row looking for the Code 128 start symbol. When the window does not match,
 * the JavaScript port shifts it with `counters = counters.slice(2, …)`, which
 * shrinks the Int32Array from 6 to 4 slots; the following writes to slots 4
 * and 5 are silently dropped by the typed array. After the first shift the
 * start pattern is compared against a truncated window and either never
 * matches or matches the wrong place (then fails its checksum). The Java
 * original uses System.arraycopy, which keeps all 6 slots.
 *
 * Effect in practice: Code 128 decodes only when the first dark pixel of the
 * scanned row IS the start symbol — true for clean synthetic test images and
 * some screenshots, but almost never for a camera frame, where the card edge,
 * a hand, a table, or printed text sits left of the barcode. This was a root
 * cause of the "barcode visible but never detected" report for Code 128, the
 * most common loyalty-card symbology. (EAN/UPC, Code 39 and Code 93 readers
 * shift their windows correctly; only Code 128 is affected.)
 *
 * The fix is a faithful port of the Java `findStartPattern`, installed once
 * over the static method that `Code128Reader.decodeRow` calls. It relies on
 * the class's static members; if a future library version renames them the
 * patch does nothing (and `code128PatchStatus` reports why) rather than
 * breaking decoding. The regression test in barcodes.test.ts fails if Code 128
 * beside dark pixels stops decoding, so a library upgrade is checked either way.
 * Remove this module once upstream ships the fix and that test passes without it.
 */
import { BitArray, Code128Reader, NotFoundException, OneDReader } from '@zxing/library'

/** Private statics of Code128Reader that the port needs (present in 0.23.0). */
interface Code128Statics {
  CODE_PATTERNS: Int32Array[]
  MAX_AVG_VARIANCE: number
  MAX_INDIVIDUAL_VARIANCE: number
  CODE_START_A: number
  CODE_START_C: number
  findStartPattern: (row: BitArray) => Int32Array
}

interface OneDStatics {
  patternMatchVariance: (counters: Int32Array, pattern: Int32Array, maxIndividualVariance: number) => number
}

export type PatchStatus = 'applied' | 'skipped: library internals changed'

function install(): PatchStatus {
  const reader = Code128Reader as unknown as Code128Statics
  const oneD = OneDReader as unknown as OneDStatics
  if (
    typeof reader.findStartPattern !== 'function' ||
    !Array.isArray(reader.CODE_PATTERNS) ||
    typeof reader.MAX_AVG_VARIANCE !== 'number' ||
    typeof reader.MAX_INDIVIDUAL_VARIANCE !== 'number' ||
    typeof reader.CODE_START_A !== 'number' ||
    typeof reader.CODE_START_C !== 'number' ||
    typeof oneD.patternMatchVariance !== 'function'
  ) {
    return 'skipped: library internals changed'
  }

  reader.findStartPattern = (row: BitArray): Int32Array => {
    const width = row.getSize()
    const rowOffset = row.getNextSet(0)
    const patternLength = 6
    const counters = new Int32Array(patternLength)
    let counterPosition = 0
    let patternStart = rowOffset
    let isWhite = false
    for (let i = rowOffset; i < width; i++) {
      if (row.get(i) !== isWhite) {
        counters[counterPosition]! += 1
        continue
      }
      if (counterPosition === patternLength - 1) {
        let bestVariance = reader.MAX_AVG_VARIANCE
        let bestMatch = -1
        for (let startCode = reader.CODE_START_A; startCode <= reader.CODE_START_C; startCode++) {
          const pattern = reader.CODE_PATTERNS[startCode]
          if (!pattern) continue
          const variance = oneD.patternMatchVariance(counters, pattern, reader.MAX_INDIVIDUAL_VARIANCE)
          if (variance < bestVariance) {
            bestVariance = variance
            bestMatch = startCode
          }
        }
        // Require whitespace before the start pattern of at least half its width.
        if (bestMatch >= 0 && row.isRange(Math.max(0, patternStart - Math.floor((i - patternStart) / 2)), patternStart, false)) {
          return Int32Array.from([patternStart, i, bestMatch])
        }
        // Slide the window by one bar/space pair, keeping all 6 slots.
        patternStart += counters[0]! + counters[1]!
        counters.copyWithin(0, 2, 2 + counterPosition - 1)
        counters[counterPosition - 1] = 0
        counters[counterPosition] = 0
        counterPosition--
      } else {
        counterPosition++
      }
      counters[counterPosition] = 1
      isWhite = !isWhite
    }
    throw new NotFoundException()
  }
  return 'applied'
}

export const code128PatchStatus: PatchStatus = install()
