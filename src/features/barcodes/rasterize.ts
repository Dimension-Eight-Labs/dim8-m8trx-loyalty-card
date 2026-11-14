/**
 * Pure-JavaScript rasterizer for bwip-js drawings.
 *
 * Why it exists: before saving a card, the app redraws the barcode and decodes
 * that drawing again with ZXing (see verify.ts). Doing this without <canvas>
 * keeps the check identical in browsers and in host tests (jsdom has no
 * canvas), so the round-trip tests exercise the same code the app runs.
 *
 * Scope: implements only what the registry's symbologies use — orthogonal
 * bar lines (1D), filled orthogonal polygons (2D), and the Aztec/QR finder
 * shapes, which BWIPP also emits as polygons. Text is skipped; callers render
 * with `includeText: false`. Ellipses (MaxiCode/DotCode) are not supported and
 * throw, so an unsupported drawing can never pass verification by accident.
 *
 * Output: an 8-bit greyscale bitmap, 0 = black, 255 = white.
 */
import type { DrawingContext } from 'bwip-js/browser'

export interface GreyBitmap {
  width: number
  height: number
  /** Row-major luminance, one byte per pixel. */
  data: Uint8ClampedArray
}

export function createBitmapDrawing(): DrawingContext<GreyBitmap> {
  let width = 0
  let height = 0
  let dx = 0
  let dy = 0
  let data = new Uint8ClampedArray(0)
  let paddingLeft = 0
  let paddingRight = 0
  let paddingTop = 0
  let paddingBottom = 0
  // Polygons accumulate until fill(); each is a closed list of points.
  let pending: Array<Array<[number, number]>> = []

  const setBlack = (x: number, y: number) => {
    if (x >= 0 && y >= 0 && x < width && y < height) data[y * width + x] = 0
  }

  return {
    setopts(options) {
      // bwip-js has already converted padding to pixels at this point.
      paddingLeft = options.paddingleft ?? 0
      paddingRight = options.paddingright ?? 0
      paddingTop = options.paddingtop ?? 0
      paddingBottom = options.paddingbottom ?? 0
    },
    scale() {
      return null
    },
    measure() {
      return { width: 0, ascent: 0, descent: 0 }
    },
    init(w, h) {
      width = Math.ceil(w + paddingLeft + paddingRight)
      height = Math.ceil(h + paddingTop + paddingBottom)
      dx = paddingLeft
      dy = paddingTop
      data = new Uint8ClampedArray(width * height).fill(255)
    },
    // Mirrors bwip-js's built-in raster semantics for orthogonal bars.
    line(x0, y0, x1, y1, lw) {
      let ax = x0 | 0
      let ay = y0 | 0
      let bx = x1 | 0
      let by = y1 | 0
      const w = Math.round(lw) || 1
      if (by < ay) [ay, by] = [by, ay]
      if (bx < ax) [ax, bx] = [bx, ax]
      const half = (w / 2) | 0
      if (ax === bx) {
        ax = ax - w + half
        bx = bx + half - 1
      } else {
        ay = ay - half
        by = by + w - half - 1
      }
      for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) setBlack(x + dx, y + dy)
    },
    polygon(pts) {
      pending.push(pts.map(([x, y]) => [x, y]))
    },
    hexagon(pts) {
      pending.push(pts.map(([x, y]) => [x, y]))
    },
    ellipse() {
      throw new Error('Ellipses are not supported by the bitmap rasterizer.')
    },
    // Even-odd scanline fill of every pending polygon, sampling pixel centres.
    fill() {
      if (pending.length === 0) return
      const edges: Array<[number, number, number, number]> = []
      for (const poly of pending) {
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
          const [xi, yi] = poly[i] as [number, number]
          const [xj, yj] = poly[j] as [number, number]
          if (yi !== yj) edges.push([xi, yi, xj, yj])
        }
      }
      for (let py = 0; py < height; py++) {
        const sy = py - dy + 0.5
        const crossings: number[] = []
        for (const [xa, ya, xb, yb] of edges) {
          if ((ya <= sy && yb > sy) || (yb <= sy && ya > sy)) {
            crossings.push(xa + ((sy - ya) * (xb - xa)) / (yb - ya))
          }
        }
        crossings.sort((a, b) => a - b)
        for (let k = 0; k + 1 < crossings.length; k += 2) {
          const start = Math.ceil((crossings[k] as number) + dx - 0.5)
          const end = Math.ceil((crossings[k + 1] as number) + dx - 0.5)
          for (let px = start; px < end; px++) setBlack(px, py)
        }
      }
      pending = []
    },
    text() {
      // Human-readable text is irrelevant to decoding and deliberately skipped.
    },
    end() {
      return { width, height, data }
    },
  }
}
