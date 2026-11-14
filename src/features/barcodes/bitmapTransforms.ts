/**
 * Pure greyscale bitmap transforms used to give the decoder several "views"
 * of the same picture (camera frame or imported image).
 *
 * Why these exist:
 * - ZXing's 1D readers only scan horizontal rows, and the luminance source we
 *   feed it (RGBLuminanceSource) does not support rotation, so ZXing's own
 *   "try harder" rotation never runs. A barcode held vertically, or a
 *   screenshot shown sideways, is therefore only readable after we rotate it.
 * - Low-contrast or tinted screenshots and dim camera frames read better after
 *   a contrast stretch or a global threshold.
 * - Blurry close-up camera frames and very large screenshots often read
 *   better after a box-filter downscale (it averages away blur and JPEG noise
 *   and brings bar widths into ZXing's comfortable range).
 *
 * Invariant: every function returns a NEW bitmap and never mutates its input,
 * so a decode cascade can try many variants of one source without altering it.
 * Everything is synchronous, allocation-bounded (output never larger than the
 * input, except rotation which has the same size), and free of DOM APIs so it
 * runs identically in browsers and host tests.
 */
import type { GreyBitmap } from './rasterize.ts'

export interface Region {
  x: number
  y: number
  width: number
  height: number
}

/** Copies a rectangular region (clamped to the bitmap). */
export function cropBitmap(bitmap: GreyBitmap, region: Region): GreyBitmap {
  const x0 = Math.max(0, Math.min(bitmap.width - 1, Math.floor(region.x)))
  const y0 = Math.max(0, Math.min(bitmap.height - 1, Math.floor(region.y)))
  const width = Math.max(1, Math.min(bitmap.width - x0, Math.round(region.width)))
  const height = Math.max(1, Math.min(bitmap.height - y0, Math.round(region.height)))
  const data = new Uint8ClampedArray(width * height)
  for (let y = 0; y < height; y++) {
    const start = (y0 + y) * bitmap.width + x0
    data.set(bitmap.data.subarray(start, start + width), y * width)
  }
  return { width, height, data }
}

/**
 * Integer box-filter downscale so the longest side is at most `maxSide`.
 * Returns a copy at the same size when no reduction is needed. Never
 * upscales: enlarging a low-resolution source adds no information and costs
 * memory on phones.
 */
export function downscaleBitmap(bitmap: GreyBitmap, maxSide: number): GreyBitmap {
  const factor = Math.ceil(Math.max(bitmap.width, bitmap.height) / Math.max(1, maxSide))
  if (factor <= 1) return { width: bitmap.width, height: bitmap.height, data: bitmap.data.slice() }
  const width = Math.max(1, Math.floor(bitmap.width / factor))
  const height = Math.max(1, Math.floor(bitmap.height / factor))
  const data = new Uint8ClampedArray(width * height)
  const area = factor * factor
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0
      for (let dy = 0; dy < factor; dy++) {
        const row = (y * factor + dy) * bitmap.width + x * factor
        for (let dx = 0; dx < factor; dx++) sum += bitmap.data[row + dx] ?? 255
      }
      data[y * width + x] = sum / area
    }
  }
  return { width, height, data }
}

/** Rotates 90° clockwise (width and height swap). */
export function rotate90(bitmap: GreyBitmap): GreyBitmap {
  const { width, height } = bitmap
  const data = new Uint8ClampedArray(width * height)
  // Source (x, y) lands at destination (height - 1 - y, x) in a height-wide image.
  for (let y = 0; y < height; y++) {
    const srcRow = y * width
    const dstX = height - 1 - y
    for (let x = 0; x < width; x++) data[x * height + dstX] = bitmap.data[srcRow + x] ?? 255
  }
  return { width: height, height: width, data }
}

/** Inverts luminance: light-on-dark codes (e.g. dark-mode apps) become dark-on-light. */
export function invertBitmap(bitmap: GreyBitmap): GreyBitmap {
  const data = new Uint8ClampedArray(bitmap.data.length)
  for (let i = 0; i < data.length; i++) data[i] = 255 - (bitmap.data[i] ?? 0)
  return { width: bitmap.width, height: bitmap.height, data }
}

/** Histogram of a bitmap, sampling every `step`-th pixel to bound cost. */
function histogram(bitmap: GreyBitmap, step: number): { counts: Uint32Array; total: number } {
  const counts = new Uint32Array(256)
  let total = 0
  for (let i = 0; i < bitmap.data.length; i += step) {
    counts[bitmap.data[i] ?? 0]! += 1
    total += 1
  }
  return { counts, total }
}

function sampleStep(bitmap: GreyBitmap): number {
  // ~250k samples is plenty for a histogram and keeps big screenshots cheap.
  return Math.max(1, Math.floor(bitmap.data.length / 250_000))
}

/**
 * Sampled luminance range. Used to detect frames that carry no picture at all
 * (camera not yet delivering, or a browser privacy feature blanking canvas
 * reads): a real scene virtually never has max − min below a few levels.
 */
export function luminanceRange(bitmap: GreyBitmap): { min: number; max: number } {
  const step = Math.max(1, Math.floor(bitmap.data.length / 4096))
  let min = 255
  let max = 0
  for (let i = 0; i < bitmap.data.length; i += step) {
    const v = bitmap.data[i] ?? 0
    if (v < min) min = v
    if (v > max) max = v
  }
  return { min, max }
}

/**
 * Linear contrast stretch between the 1st and 99th luminance percentiles.
 * Percentiles (not min/max) so a few specular highlights or black borders do
 * not prevent the stretch. Returns a copy unchanged if the image is flat.
 */
export function stretchContrast(bitmap: GreyBitmap): GreyBitmap {
  const { counts, total } = histogram(bitmap, sampleStep(bitmap))
  const lowTarget = total * 0.01
  const highTarget = total * 0.99
  let low = 0
  let high = 255
  let seen = 0
  for (let v = 0; v < 256; v++) {
    seen += counts[v] ?? 0
    if (seen > lowTarget) {
      low = v
      break
    }
  }
  seen = 0
  for (let v = 0; v < 256; v++) {
    seen += counts[v] ?? 0
    if (seen >= highTarget) {
      high = v
      break
    }
  }
  const data = new Uint8ClampedArray(bitmap.data.length)
  if (high - low < 2) {
    data.set(bitmap.data)
  } else {
    const scale = 255 / (high - low)
    for (let i = 0; i < data.length; i++) data[i] = ((bitmap.data[i] ?? 0) - low) * scale
  }
  return { width: bitmap.width, height: bitmap.height, data }
}

/**
 * Global threshold at Otsu's level (maximises between-class variance). ZXing
 * binarizes locally; a single global threshold helps when coloured app
 * backgrounds or gradients confuse the local thresholds.
 */
export function binarizeOtsu(bitmap: GreyBitmap): GreyBitmap {
  const { counts, total } = histogram(bitmap, sampleStep(bitmap))
  let sumAll = 0
  for (let v = 0; v < 256; v++) sumAll += v * (counts[v] ?? 0)
  let sumBelow = 0
  let weightBelow = 0
  let bestVariance = -1
  let threshold = 128
  for (let v = 0; v < 256; v++) {
    weightBelow += counts[v] ?? 0
    if (weightBelow === 0) continue
    const weightAbove = total - weightBelow
    if (weightAbove === 0) break
    sumBelow += v * (counts[v] ?? 0)
    const meanBelow = sumBelow / weightBelow
    const meanAbove = (sumAll - sumBelow) / weightAbove
    const variance = weightBelow * weightAbove * (meanBelow - meanAbove) ** 2
    if (variance > bestVariance) {
      bestVariance = variance
      threshold = v
    }
  }
  const data = new Uint8ClampedArray(bitmap.data.length)
  for (let i = 0; i < data.length; i++) data[i] = (bitmap.data[i] ?? 0) > threshold ? 255 : 0
  return { width: bitmap.width, height: bitmap.height, data }
}
