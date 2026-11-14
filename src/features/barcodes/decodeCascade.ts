/**
 * Bounded multi-view decode for still images (imported screenshots/photos and
 * their cropped retries). Live camera scanning does NOT use this module; it
 * has its own per-frame views in scanLoop.ts.
 *
 * v0.3.0 made exactly one decode attempt on the whole image. That attempt
 * fails for barcodes shown sideways (ZXing cannot rotate our luminance
 * source, so its "try harder" rotation never ran), for light-on-dark codes,
 * for low-contrast or tinted images, and for noisy or very large photos —
 * and Code 128 additionally failed whenever anything dark preceded it on a
 * row (see zxingPatches.ts). This cascade tries progressively more
 * transformed views of the same pixels until one decodes.
 *
 * QR sweep (v0.3.2, Iteration 4B regression fix): v0.3.1 began decoding
 * imports at native resolution (up to 3000 px) and offered only ½ and ¼
 * downscales. Host experiments with real PNG fixtures (src/test/fixtures/qr)
 * showed ZXing's QR finder failing at native resolution on two common kinds of
 * image — small QR bitmaps that an app or web page enlarged with smoothing
 * (soft module edges), and noisy/JPEG photographs — while the same pixels
 * decode after a box downscale or a global threshold. No single scale works
 * for every image (a logo QR that reads natively fails at ½). Meanwhile every
 * failing full-resolution step ran all ~15 ZXing readers with TRY_HARDER
 * (up to ~0.9 s each on a desktop), so QR-friendly views could be reached
 * only seconds later — or never, once the time budget ran out on a phone.
 * The sweep therefore tries QR-only decodes (cheap: a few ms to ~60 ms each)
 * over a threshold view and several integer downscales immediately after the
 * original attempt, before the expensive all-format fallbacks.
 *
 * Original first: step 1 always decodes the unmodified base bitmap with every
 * format. Every later view is derived from that same base; transforms only
 * downscale (box average), threshold, invert, or rotate the whole bitmap —
 * they never crop — so finder patterns and the quiet zone stay intact.
 *
 * Weak reads: a detect-only symbology (reported as `unsupported`) or a
 * Code 39 read (no mandatory check character) can be a false positive from
 * texture or text. Such a read no longer ends the cascade at once: the cheap
 * QR sweep steps still run, and a QR (or any other checked) read found there
 * wins. If none is found, the first weak read is returned unchanged. Costly
 * all-format steps are skipped after a weak read so a genuine Code 39 card
 * is not delayed by seconds.
 *
 * Rotation: only 90° is tried. ZXing's 1D readers already read each row in
 * both directions (so 180° adds nothing for barcodes) and the 2D readers are
 * rotation-invariant; 270° is 90° plus 180°, so it is covered too.
 *
 * Bounds: steps run in a fixed order, cheapest/most-likely first, and stop at
 * the first strong read or when the time budget is spent (the first step
 * always runs). Between steps the cascade yields to the event loop so the UI
 * keeps painting. Each view is a temporary bitmap released after its attempt;
 * the base bitmap is never modified (bitmapTransforms.ts returns copies).
 */
import { binarizeOtsu, downscaleBitmap, invertBitmap, rotate90, stretchContrast } from './bitmapTransforms.ts'
import { decodeBitmap, type DecodeResult } from './decode.ts'
import type { BarcodeFormat } from './formats.ts'
import type { GreyBitmap } from './rasterize.ts'

export interface CascadeStep {
  /** Privacy-safe label for diagnostics/tests. */
  label: string
  /** Builds the view from the base bitmap, or returns null when the step does not apply. */
  view(base: GreyBitmap): GreyBitmap | null
  /**
   * Restricts this step to these formats (default: every format). Restricted
   * steps are the cheap QR sweep; they still run after a weak read.
   */
  formats?: readonly BarcodeFormat[]
}

const longest = (bitmap: GreyBitmap) => Math.max(bitmap.width, bitmap.height)

/** Box-downscale by an integer factor, only if the result keeps enough detail to be worth a try. */
function shrink(base: GreyBitmap, factor: number, minSide = 400): GreyBitmap | null {
  const target = Math.floor(longest(base) / factor)
  return target >= minSide ? downscaleBitmap(base, target) : null
}

/**
 * Smallest view the QR sweep tries. A version-1 QR (21 modules + quiet zone)
 * still has ~2 px modules when it fills a third of a 300 px view; the sweep
 * is cheap, so it can afford smaller views than the all-format steps.
 */
const QR_SWEEP_MIN_SIDE = 300
const QR_ONLY: readonly BarcodeFormat[] = ['qrcode']

/** Downscale factor for the sweep, skipped when it would not change the size (factor ≤ 1). */
function sweepShrink(base: GreyBitmap, factor: number): GreyBitmap | null {
  return shrink(base, factor, QR_SWEEP_MIN_SIDE)
}

export const IMAGE_CASCADE: readonly CascadeStep[] = [
  // 1. The unmodified image, every format.
  { label: 'original', view: (base) => base },
  // 2. QR sweep: global threshold at native size, then integer box downscales
  //    (plain and thresholded), then dark mode. Integer factors avoid the
  //    duplicate views a "max side" target would produce for similar sizes.
  { label: 'qr-threshold', formats: QR_ONLY, view: (base) => binarizeOtsu(base) },
  { label: 'qr-half', formats: QR_ONLY, view: (base) => sweepShrink(base, 2) },
  { label: 'qr-third', formats: QR_ONLY, view: (base) => sweepShrink(base, 3) },
  { label: 'qr-quarter', formats: QR_ONLY, view: (base) => sweepShrink(base, 4) },
  { label: 'qr-half-threshold', formats: QR_ONLY, view: (base) => mapView(sweepShrink(base, 2), binarizeOtsu) },
  { label: 'qr-third-threshold', formats: QR_ONLY, view: (base) => mapView(sweepShrink(base, 3), binarizeOtsu) },
  { label: 'qr-sixth', formats: QR_ONLY, view: (base) => sweepShrink(base, 6) },
  { label: 'qr-half-inverted', formats: QR_ONLY, view: (base) => invertBitmap(sweepShrink(base, 2) ?? base) },
  // 3. All-format fallbacks (1D codes, PDF417, Data Matrix, Aztec…).
  { label: 'half-size', view: (base) => shrink(base, 2) },
  { label: 'contrast', view: (base) => stretchContrast(base) },
  { label: 'rotated', view: (base) => rotate90(shrink(base, 2) ?? base) },
  { label: 'threshold', view: (base) => binarizeOtsu(base) },
  { label: 'inverted', view: (base) => invertBitmap(base) },
  { label: 'quarter-size', view: (base) => shrink(base, 4) },
  { label: 'rotated-contrast', view: (base) => rotate90(stretchContrast(base)) },
]

function mapView(view: GreyBitmap | null, transform: (bitmap: GreyBitmap) => GreyBitmap): GreyBitmap | null {
  return view ? transform(view) : null
}

export interface CascadeOutcome {
  result: DecodeResult
  /** Steps actually attempted. */
  attempts: number
  /** Label of the step that produced the result, if any. */
  step?: string
  /** True if the time budget ended the cascade early. */
  timedOut: boolean
}

export interface CascadeOptions {
  /** Total time budget; later steps are skipped once it is spent. */
  budgetMs?: number
  steps?: readonly CascadeStep[]
  now?: () => number
  /** Yields between steps; defaults to a zero-delay timer. */
  pause?: () => Promise<void>
  decode?: typeof decodeBitmap
}

/** iPhone-class devices decode a 3 MP screenshot view in well under a second; 8 s bounds the worst case. */
export const DEFAULT_CASCADE_BUDGET_MS = 8000

/**
 * True for reads that may be false positives (see "Weak reads" above): no
 * check digit/ECC protects them. QR, Data Matrix, Aztec and PDF417 carry
 * error correction; EAN/UPC and Code 128 carry check characters.
 */
export function isWeakRead(result: DecodeResult): boolean {
  return result.status === 'unsupported' || (result.status === 'decoded' && result.format === 'code39')
}

export async function decodeWithCascade(base: GreyBitmap, options: CascadeOptions = {}): Promise<CascadeOutcome> {
  const steps = options.steps ?? IMAGE_CASCADE
  const now = options.now ?? (() => performance.now())
  const pause = options.pause ?? (() => new Promise<void>((resolve) => setTimeout(resolve, 0)))
  const decode = options.decode ?? decodeBitmap
  const budget = options.budgetMs ?? DEFAULT_CASCADE_BUDGET_MS
  const started = now()
  let attempts = 0
  let decoderError = false
  let weak: { result: DecodeResult; step: string } | undefined

  const finish = (timedOut: boolean): CascadeOutcome =>
    weak
      ? { result: weak.result, attempts, step: weak.step, timedOut }
      : { result: notFound(decoderError), attempts, timedOut }

  for (const step of steps) {
    // After a weak read only the cheap restricted (QR sweep) steps still run.
    if (weak && !step.formats) continue
    if (attempts > 0) {
      if (now() - started >= budget) return finish(true)
      await pause()
    }
    const view = step.view(base)
    if (!view) continue
    attempts += 1
    let result: DecodeResult
    try {
      result = decode(view, step.formats ? { tryHarder: true, formats: step.formats } : { tryHarder: true })
    } catch {
      result = { status: 'not-found', reason: 'decoder-error' }
    }
    if (result.status === 'not-found') {
      if (result.reason === 'decoder-error') decoderError = true
      continue
    }
    if (!isWeakRead(result)) return { result, attempts, step: step.label, timedOut: false }
    weak ??= { result, step: step.label }
  }
  return finish(false)
}

function notFound(decoderError: boolean): DecodeResult {
  return decoderError ? { status: 'not-found', reason: 'decoder-error' } : { status: 'not-found' }
}
