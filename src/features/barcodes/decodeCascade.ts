/**
 * Bounded multi-view decode for still images (imported screenshots/photos and
 * their cropped retries).
 *
 * v0.3.0 made exactly one decode attempt on the whole image. That attempt
 * fails for barcodes shown sideways (ZXing cannot rotate our luminance
 * source, so its "try harder" rotation never ran), for light-on-dark codes,
 * for low-contrast or tinted images, and for noisy or very large photos —
 * and Code 128 additionally failed whenever anything dark preceded it on a
 * row (see zxingPatches.ts). This cascade tries progressively more
 * transformed views of the same pixels until one decodes.
 *
 * Rotation: only 90° is tried. ZXing's 1D readers already read each row in
 * both directions (so 180° adds nothing for barcodes) and the 2D readers are
 * rotation-invariant; 270° is 90° plus 180°, so it is covered too.
 *
 * Bounds: steps run in a fixed order, cheapest/most-likely first, and stop at
 * the first read or when the time budget is spent (the first step always
 * runs). Between steps the cascade yields to the event loop so the UI keeps
 * painting. Each view is a temporary bitmap released after its attempt; the
 * base bitmap is never modified (bitmapTransforms.ts returns copies).
 */
import { binarizeOtsu, downscaleBitmap, invertBitmap, rotate90, stretchContrast } from './bitmapTransforms.ts'
import { decodeBitmap, type DecodeResult } from './decode.ts'
import type { GreyBitmap } from './rasterize.ts'

export interface CascadeStep {
  /** Privacy-safe label for diagnostics/tests. */
  label: string
  /** Builds the view from the base bitmap, or returns null when the step does not apply. */
  view(base: GreyBitmap): GreyBitmap | null
}

const longest = (bitmap: GreyBitmap) => Math.max(bitmap.width, bitmap.height)

/** Box-downscale by an integer factor, only if the result keeps enough detail to be worth a try. */
function shrink(base: GreyBitmap, factor: number): GreyBitmap | null {
  const target = Math.floor(longest(base) / factor)
  return target >= 400 ? downscaleBitmap(base, target) : null
}

export const IMAGE_CASCADE: readonly CascadeStep[] = [
  { label: 'original', view: (base) => base },
  { label: 'half-size', view: (base) => shrink(base, 2) },
  { label: 'contrast', view: (base) => stretchContrast(base) },
  { label: 'rotated', view: (base) => rotate90(shrink(base, 2) ?? base) },
  { label: 'threshold', view: (base) => binarizeOtsu(base) },
  { label: 'inverted', view: (base) => invertBitmap(base) },
  { label: 'quarter-size', view: (base) => shrink(base, 4) },
  { label: 'rotated-contrast', view: (base) => rotate90(stretchContrast(base)) },
]

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

export async function decodeWithCascade(base: GreyBitmap, options: CascadeOptions = {}): Promise<CascadeOutcome> {
  const steps = options.steps ?? IMAGE_CASCADE
  const now = options.now ?? (() => performance.now())
  const pause = options.pause ?? (() => new Promise<void>((resolve) => setTimeout(resolve, 0)))
  const decode = options.decode ?? decodeBitmap
  const budget = options.budgetMs ?? DEFAULT_CASCADE_BUDGET_MS
  const started = now()
  let attempts = 0
  let decoderError = false

  for (const step of steps) {
    if (attempts > 0) {
      if (now() - started >= budget) {
        return { result: notFound(decoderError), attempts, timedOut: true }
      }
      await pause()
    }
    const view = step.view(base)
    if (!view) continue
    attempts += 1
    let result: DecodeResult
    try {
      result = decode(view, { tryHarder: true })
    } catch {
      result = { status: 'not-found', reason: 'decoder-error' }
    }
    if (result.status !== 'not-found') return { result, attempts, step: step.label, timedOut: false }
    if (result.reason === 'decoder-error') decoderError = true
  }
  return { result: notFound(decoderError), attempts, timedOut: false }
}

function notFound(decoderError: boolean): DecodeResult {
  return decoderError ? { status: 'not-found', reason: 'decoder-error' } : { status: 'not-found' }
}
