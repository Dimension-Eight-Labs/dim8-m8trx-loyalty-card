/**
 * Browser pixel acquisition for imported images: load a local file, read
 * (optionally cropped) pixels for decoding, and produce a cropped fallback
 * image. Everything happens in memory via object URLs and <canvas>; nothing
 * is uploaded.
 *
 * Not unit-testable in jsdom (no canvas or image decoding). UI tests inject
 * fakes through CaptureServices; the decoder and the decode cascade are tested
 * directly with real bitmaps in barcodes.test.ts.
 */
import { rgbaToGrey, type DecodeResult } from './decode.ts'
import { decodeWithCascade } from './decodeCascade.ts'

/** Crop rectangle in the image's natural pixel coordinates. */
export interface PixelArea {
  x: number
  y: number
  width: number
  height: number
}

export interface LoadedImage {
  /** Object URL for display (e.g. in the cropper). */
  url: string
  width: number
  height: number
  /** Revokes the object URL. Call when the image is no longer shown. */
  release(): void
}

export class ImageLoadError extends Error {
  constructor(message = 'That file couldn’t be opened as an image.') {
    super(message)
    this.name = 'ImageLoadError'
  }
}

/**
 * Longest side of the base bitmap used for decoding. 3000 px keeps every
 * current iPhone screenshot (up to 2868 px tall) at its native resolution:
 * v0.3.0 capped at 2000 px, so screenshots were resampled by the browser
 * before decoding, blurring thin bars. Larger photos are scaled down to this
 * (≈27 MB of RGBA for a 4:3 photo, released right after conversion); the
 * cascade then tries smaller views itself.
 */
const DECODE_MAX_SIDE = 3000
/** Longest side of a saved fallback image: sharp on any phone, small in storage. */
const FALLBACK_MAX_SIDE = 1400

const imageElements = new WeakMap<LoadedImage, HTMLImageElement>()

export async function loadImage(file: Blob): Promise<LoadedImage> {
  if (file.type && !file.type.startsWith('image/')) throw new ImageLoadError('Choose an image file (PNG, JPEG, HEIC…).')
  const url = URL.createObjectURL(file)
  const element = new Image()
  element.decoding = 'async'
  element.src = url
  try {
    await element.decode()
  } catch {
    URL.revokeObjectURL(url)
    throw new ImageLoadError()
  }
  const loaded: LoadedImage = {
    url,
    width: element.naturalWidth,
    height: element.naturalHeight,
    release: () => URL.revokeObjectURL(url),
  }
  imageElements.set(loaded, element)
  return loaded
}

/**
 * Draws (part of) the image onto a new canvas.
 *
 * `whiteUnderlay` paints the canvas white first so transparent areas become
 * white in the saved fallback PNG. The decode path does NOT use it (v0.3.2):
 * rgbaToGrey already composites transparent pixels onto white, and reading
 * back only image pixels keeps the import path identical to the live camera
 * path (drawImage + getImageData), which is known to work on iPhone. Script-
 * drawn canvas content such as fillRect is what browser fingerprinting
 * protections (e.g. Safari's Advanced Fingerprinting Protection) may perturb
 * on readback; whether that affected imports on iPhone is unverified.
 */
function drawRegion(image: LoadedImage, area: PixelArea | undefined, maxSide: number, whiteUnderlay: boolean): HTMLCanvasElement {
  const element = imageElements.get(image)
  if (!element) throw new ImageLoadError()
  const region = area ?? { x: 0, y: 0, width: image.width, height: image.height }
  const scale = Math.min(1, maxSide / Math.max(region.width, region.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(region.width * scale))
  canvas.height = Math.max(1, Math.round(region.height * scale))
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new ImageLoadError('This browser can’t process images.')
  if (whiteUnderlay) {
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
  }
  context.drawImage(element, region.x, region.y, region.width, region.height, 0, 0, canvas.width, canvas.height)
  return canvas
}

/**
 * Decodes the whole image, or a cropped region of it, trying the bounded
 * cascade of views in decodeCascade.ts: the original pixels first (every
 * format), then a cheap QR sweep (threshold and integer downscales), then
 * all-format fallbacks (smaller, contrast, rotated, threshold, inverted…).
 * The loaded image and its object URL are never modified; every view is a
 * temporary in-memory bitmap.
 */
export async function decodeImage(image: LoadedImage, area?: PixelArea): Promise<DecodeResult> {
  // Yield once so the "Looking for a barcode…" state paints before the
  // first synchronous decode (which can take a few hundred ms on large images).
  await new Promise((resolve) => setTimeout(resolve, 0))
  const canvas = drawRegion(image, area, DECODE_MAX_SIDE, false)
  const context = canvas.getContext('2d') as CanvasRenderingContext2D
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height)
  const base = rgbaToGrey(pixels.data, canvas.width, canvas.height)
  // Release the canvas backing store before the cascade allocates its views
  // (iOS limits total canvas memory per page).
  canvas.width = 0
  canvas.height = 0
  const outcome = await decodeWithCascade(base)
  if (import.meta.env.DEV) {
    console.debug('[import] decode', { width: base.width, height: base.height, attempts: outcome.attempts, step: outcome.step, timedOut: outcome.timedOut, status: outcome.result.status })
  }
  return outcome.result
}

/** Cropped PNG for the image fallback. */
export function cropImage(image: LoadedImage, area: PixelArea): Promise<Blob> {
  const canvas = drawRegion(image, area, FALLBACK_MAX_SIDE, true)
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new ImageLoadError('Couldn’t crop the image.'))), 'image/png')
  })
}
