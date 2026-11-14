/**
 * Detects browsers that alter or block canvas pixel reads.
 *
 * Both live scanning and screenshot decoding read pixels back from a
 * <canvas> (getImageData). Some privacy features randomise or blank those
 * reads to resist fingerprinting (for example Brave Shields' fingerprinting
 * protection in its stricter modes, or Safari's Advanced Fingerprinting
 * Protection). Light noise is harmless, but heavy alteration makes every
 * frame unreadable while the viewfinder still looks perfect — the exact
 * symptom of an "inactive" scanner — so we check once and explain it.
 *
 * The probe draws a known black/white checkerboard and counts pixels that
 * come back more than a quarter of the range away from what was drawn. It is
 * a heuristic: a browser could pass the probe and still alter real frames
 * (or vice versa), so the result is reported as a diagnostic, never used to
 * block scanning. Whether any particular Brave/iOS configuration triggers it
 * is unverified until checked on a real device.
 */

export type CanvasReadback = 'ok' | 'altered' | 'unavailable'

/** Fraction of mismatched pixels above which reads count as altered. */
const ALTERED_FRACTION = 0.02
const SIZE = 16

let cached: CanvasReadback | undefined

export function probeCanvasReadback(): CanvasReadback {
  if (cached) return cached
  cached = runProbe()
  return cached
}

/** Test hook: forget the cached probe result. */
export function resetCanvasProbe(): void {
  cached = undefined
}

function runProbe(): CanvasReadback {
  try {
    const canvas = document.createElement('canvas')
    canvas.width = SIZE
    canvas.height = SIZE
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) return 'unavailable'
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        context.fillStyle = (x + y) % 2 === 0 ? '#000000' : '#ffffff'
        context.fillRect(x, y, 1, 1)
      }
    }
    const { data } = context.getImageData(0, 0, SIZE, SIZE)
    let mismatched = 0
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const expected = (x + y) % 2 === 0 ? 0 : 255
        const i = (y * SIZE + x) * 4
        const worst = Math.max(
          Math.abs((data[i] ?? 0) - expected),
          Math.abs((data[i + 1] ?? 0) - expected),
          Math.abs((data[i + 2] ?? 0) - expected),
        )
        if (worst > 64) mismatched += 1
      }
    }
    return mismatched / (SIZE * SIZE) > ALTERED_FRACTION ? 'altered' : 'ok'
  } catch {
    return 'unavailable'
  }
}
