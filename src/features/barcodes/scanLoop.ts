/**
 * Live-scan loop controller: decides what to decode on each tick, keeps the
 * loop alive through per-frame failures, and delivers exactly one confirmed
 * result.
 *
 * Deliberately free of DOM APIs. Frame capture, decoding, scheduling and the
 * clock are injected, so the lifecycle rules below are unit-tested in host
 * tests (camera.test.ts) and camera.ts only adapts them to <video>/<canvas>.
 *
 * Lifecycle rules (the v0.3.0 scanner violated the first one: any exception
 * thrown while sampling ended its setTimeout chain silently, leaving a live
 * viewfinder that no longer decoded anything):
 * - Every tick reschedules the next one unless the loop is stopped, whatever
 *   the tick's outcome: frame not ready, blank frame, capture error, decoder
 *   error, or a miss.
 * - `stop()` is idempotent and cancels the pending tick. No callback runs
 *   after stop.
 * - A result is delivered at most once; the loop stops itself before
 *   delivering it.
 *
 * Frame strategy: one decode per tick, cycling through LIVE_VARIANTS so each
 * tick stays bounded (no tick runs the whole cascade). Measured on synthetic
 * noisy frames in host tests: full-resolution frames with sensor-like noise
 * defeat ZXing's QR finder and 1D readers, while a 2× box-filter downscale
 * of the same frame decodes, so downscaled views come first. Native
 * resolution is still tried for small or dense codes, the whole frame for
 * codes outside the guide, a 90° rotation for barcodes held vertically
 * (ZXing cannot rotate our luminance source itself), a contrast stretch for
 * dim scenes, and periodically every supported format with "try harder".
 *
 * Privacy: statistics contain counts, dimensions, timings and error
 * categories only — never decoded values or pixels.
 */
import { luminanceRange, rotate90, stretchContrast, downscaleBitmap, type Region } from './bitmapTransforms.ts'
import { PRIORITY_FORMATS, type DecodeOptions, type DecodeResult } from './decode.ts'
import type { GreyBitmap } from './rasterize.ts'

export type FoundResult = Exclude<DecodeResult, { status: 'not-found' }>

/** Which part of the video frame a variant reads. */
export type FrameSource = 'guide' | 'full'

export interface ScanVariant {
  source: FrameSource
  /** Longest side of the captured pixels (the canvas scales on draw). */
  grabMaxSide: number
  /** Optional box-filter downscale applied in JS after capture (averages noise and blur). */
  downscaleTo?: number
  transform?: 'rotate90' | 'contrast'
  decode: DecodeOptions
}

/**
 * Order matters: the first variants are the cheapest and, in host
 * experiments, the most likely to succeed. A full cycle takes ~1.2 s at the
 * nominal tick rate.
 */
export const LIVE_VARIANTS: readonly ScanVariant[] = [
  { source: 'guide', grabMaxSide: 1280, downscaleTo: 720, decode: { formats: PRIORITY_FORMATS } },
  { source: 'guide', grabMaxSide: 1280, decode: { formats: PRIORITY_FORMATS } },
  { source: 'full', grabMaxSide: 1280, downscaleTo: 720, decode: { formats: PRIORITY_FORMATS } },
  { source: 'guide', grabMaxSide: 1280, downscaleTo: 720, transform: 'rotate90', decode: { formats: PRIORITY_FORMATS } },
  { source: 'guide', grabMaxSide: 1280, downscaleTo: 720, transform: 'contrast', decode: { formats: PRIORITY_FORMATS } },
  // Every supported format plus detect-only ones (so unsupported codes are explained), slower.
  { source: 'guide', grabMaxSide: 1280, downscaleTo: 960, decode: { tryHarder: true } },
]

export type FrameErrorCategory = 'canvas-unavailable' | 'frame-capture' | 'decoder'

/** Thrown by frame grabbers to report a specific, privacy-safe failure category. */
export class FrameError extends Error {
  readonly category: FrameErrorCategory
  constructor(category: FrameErrorCategory) {
    super(category)
    this.name = 'FrameError'
    this.category = category
  }
}

export type GrabResult =
  | { status: 'ok'; bitmap: GreyBitmap; frameWidth: number; frameHeight: number }
  | { status: 'not-ready' }

export interface LoopStats {
  phase: 'scanning' | 'decoded' | 'stopped'
  /** Ticks run so far. */
  ticks: number
  /** Frames that reached the decoder. */
  framesDecoded: number
  /** Ticks where the video had no frame yet (zero size or not enough data). */
  framesNotReady: number
  /** Frames with (almost) no luminance variation: no picture to decode. */
  blankFrames: number
  /** Ticks where capturing pixels threw. */
  frameErrors: number
  /** Decoder faults other than "nothing found". */
  decoderErrors: number
  /** Decoded frames without a barcode. */
  misses: number
  /** A barcode read that still awaits a confirming second read. */
  unconfirmedReads: number
  lastErrorCategory?: FrameErrorCategory
  /** Actual video frame size of the last captured frame. */
  frameWidth: number
  frameHeight: number
  /** Size of the last bitmap handed to the decoder. */
  sampleWidth: number
  sampleHeight: number
  /** Duration of the last tick (capture + transform + decode). */
  lastTickMs: number
  elapsedMs: number
}

export interface ScanLoopDeps {
  grab(source: FrameSource, maxSide: number): GrabResult
  decode(bitmap: GreyBitmap, options: DecodeOptions): DecodeResult
  /** Runs `callback` after about `delayMs`; returns a cancel function. */
  schedule(callback: () => void, delayMs: number): () => void
  now(): number
  onResult(result: FoundResult): void
  onStats?(stats: LoopStats): void
  variants?: readonly ScanVariant[]
}

export interface ScanLoop {
  stop(): void
  stats(): LoopStats
}

/**
 * Tick pacing. The gap after a tick is the tick's own duration clamped to
 * [MIN, MAX]: fast devices sample up to ~8 times a second, and on slower
 * devices decoding uses at most about half the main thread as long as a tick
 * takes under MAX. Longer ticks still leave MAX for the UI between decodes.
 */
export const MIN_TICK_GAP_MS = 120
export const MAX_TICK_GAP_MS = 400
/** Statistics are reported at most this often (plus on every phase change). */
const STATS_INTERVAL_MS = 500
/** A real scene virtually never spans fewer luminance levels than this. */
const BLANK_RANGE = 8
/** A confirming read must arrive within this window or the candidate is dropped. */
const CONFIRM_WINDOW_MS = 2500

/**
 * Reads needed before a result is accepted. Code 39 has no mandatory check
 * character and the detect-only symbologies (Codabar, ITF…) are prone to
 * partial reads, so a single noisy frame could yield a wrong value; requiring
 * two identical reads costs a fraction of a second. EAN/UPC (check digit),
 * Code 128 (mod-103 checksum) and 2D codes (error correction) are trusted on
 * one read.
 */
export function confirmationsRequired(result: FoundResult): number {
  if (result.status === 'unsupported') return 2
  return result.format === 'code39' ? 2 : 1
}

export function startScanLoop(deps: ScanLoopDeps): ScanLoop {
  const variants = deps.variants ?? LIVE_VARIANTS
  const startedAt = deps.now()
  const stats: LoopStats = {
    phase: 'scanning',
    ticks: 0,
    framesDecoded: 0,
    framesNotReady: 0,
    blankFrames: 0,
    frameErrors: 0,
    decoderErrors: 0,
    misses: 0,
    unconfirmedReads: 0,
    frameWidth: 0,
    frameHeight: 0,
    sampleWidth: 0,
    sampleHeight: 0,
    lastTickMs: 0,
    elapsedMs: 0,
  }
  let stopped = false
  let cancelPending: (() => void) | undefined
  let lastStatsAt = -Infinity
  let candidate: { key: string; count: number; at: number } | undefined

  const snapshot = (): LoopStats => ({ ...stats, elapsedMs: deps.now() - startedAt })

  const report = (force: boolean) => {
    const now = deps.now()
    if (!deps.onStats || (!force && now - lastStatsAt < STATS_INTERVAL_MS)) return
    lastStatsAt = now
    deps.onStats(snapshot())
  }

  const halt = (phase: LoopStats['phase']) => {
    stopped = true
    cancelPending?.()
    cancelPending = undefined
    stats.phase = phase
  }

  /** Returns true when `result` is confirmed and should be delivered. */
  const confirm = (result: FoundResult, now: number): boolean => {
    const key = result.status === 'decoded' ? `${result.format}\u0000${result.value}` : `?${result.formatLabel}\u0000${result.value}`
    if (!candidate || candidate.key !== key || now - candidate.at > CONFIRM_WINDOW_MS) candidate = { key, count: 0, at: now }
    candidate.count += 1
    candidate.at = now
    if (candidate.count >= confirmationsRequired(result)) return true
    stats.unconfirmedReads += 1
    return false
  }

  const tick = () => {
    cancelPending = undefined
    if (stopped) return
    const variant = variants[stats.ticks % variants.length]!
    stats.ticks += 1
    const tickStart = deps.now()
    try {
      const grabbed = deps.grab(variant.source, variant.grabMaxSide)
      if (grabbed.status === 'not-ready') {
        stats.framesNotReady += 1
      } else {
        stats.frameWidth = grabbed.frameWidth
        stats.frameHeight = grabbed.frameHeight
        const range = luminanceRange(grabbed.bitmap)
        if (range.max - range.min < BLANK_RANGE) {
          stats.blankFrames += 1
        } else {
          let bitmap = grabbed.bitmap
          if (variant.downscaleTo) bitmap = downscaleBitmap(bitmap, variant.downscaleTo)
          if (variant.transform === 'rotate90') bitmap = rotate90(bitmap)
          else if (variant.transform === 'contrast') bitmap = stretchContrast(bitmap)
          stats.sampleWidth = bitmap.width
          stats.sampleHeight = bitmap.height
          let result: DecodeResult
          try {
            result = deps.decode(bitmap, variant.decode)
          } catch {
            result = { status: 'not-found', reason: 'decoder-error' }
          }
          stats.framesDecoded += 1
          if (result.status === 'not-found') {
            stats.misses += 1
            if (result.reason === 'decoder-error') {
              stats.decoderErrors += 1
              stats.lastErrorCategory = 'decoder'
            }
          } else if (confirm(result, deps.now())) {
            stats.lastTickMs = deps.now() - tickStart
            halt('decoded')
            report(true)
            deps.onResult(result)
            return
          }
        }
      }
    } catch (error) {
      stats.frameErrors += 1
      stats.lastErrorCategory = error instanceof FrameError ? error.category : 'frame-capture'
    }
    stats.lastTickMs = deps.now() - tickStart
    report(false)
    if (!stopped) {
      const gap = Math.min(MAX_TICK_GAP_MS, Math.max(MIN_TICK_GAP_MS, stats.lastTickMs))
      cancelPending = deps.schedule(tick, gap)
    }
  }

  cancelPending = deps.schedule(tick, 0)
  report(true)

  return {
    stop() {
      if (stopped) return
      halt('stopped')
      report(true)
    },
    stats: snapshot,
  }
}

/**
 * Maps the on-screen guide frame to video pixel coordinates.
 *
 * The <video> uses `object-fit: cover`, so the visible part of the frame is
 * a centred crop whose aspect matches the element. The CSS guide spans
 * 8–92 % horizontally and 32–68 % vertically of that visible area; the
 * region returned here is deliberately more generous (3–97 %, 20–80 %) so a
 * barcode only roughly inside the guide still reads. Falls back to the same
 * fractions of the whole frame when the element has no layout size.
 */
export function guideRegion(frameWidth: number, frameHeight: number, viewWidth: number, viewHeight: number): Region {
  let visible: Region = { x: 0, y: 0, width: frameWidth, height: frameHeight }
  if (viewWidth > 0 && viewHeight > 0) {
    const scale = Math.max(viewWidth / frameWidth, viewHeight / frameHeight)
    const width = Math.min(frameWidth, viewWidth / scale)
    const height = Math.min(frameHeight, viewHeight / scale)
    visible = { x: (frameWidth - width) / 2, y: (frameHeight - height) / 2, width, height }
  }
  return {
    x: Math.round(visible.x + visible.width * 0.03),
    y: Math.round(visible.y + visible.height * 0.2),
    width: Math.max(1, Math.round(visible.width * 0.94)),
    height: Math.max(1, Math.round(visible.height * 0.6)),
  }
}
