/**
 * Minimal PNG decoder for host tests (Node only).
 *
 * Why it exists: jsdom has no image decoding or canvas, but the QR
 * image-import regression must be tested with real image files rather than
 * in-memory bitmaps. This reads a PNG file into RGBA pixels so the fixture can
 * be fed through the same rgbaToGrey → decodeWithCascade path the browser uses
 * after drawing the image on a canvas.
 *
 * Scope (deliberately small, test-only, no dependency): non-interlaced PNGs
 * with 8-bit greyscale, grey+alpha, RGB, RGBA, or palette colour. Anything
 * else throws, so an unsupported fixture fails loudly instead of decoding to
 * garbage. Not shipped in the production bundle.
 */
import { readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'

export interface RgbaImage {
  width: number
  height: number
  data: Uint8ClampedArray
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }

export function readPng(path: string): RgbaImage {
  return decodePng(readFileSync(path))
}

export function decodePng(file: Uint8Array): RgbaImage {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength)
  SIGNATURE.forEach((byte, i) => {
    if (file[i] !== byte) throw new Error('Not a PNG file')
  })
  let width = 0
  let height = 0
  let colorType = 0
  let palette: Uint8Array = new Uint8Array(0)
  let transparency: Uint8Array = new Uint8Array(0)
  const idat: Uint8Array[] = []
  for (let offset = 8; offset < file.length; ) {
    const length = view.getUint32(offset)
    const type = String.fromCharCode(...file.subarray(offset + 4, offset + 8))
    const body = file.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = view.getUint32(offset + 8)
      height = view.getUint32(offset + 12)
      const bitDepth = body[8]
      colorType = body[9] ?? 0
      if (bitDepth !== 8 || body[12] !== 0 || CHANNELS[colorType] === undefined) {
        throw new Error(`Unsupported PNG (bit depth ${bitDepth}, colour type ${colorType}, interlace ${body[12]})`)
      }
    } else if (type === 'PLTE') palette = body
    else if (type === 'tRNS') transparency = body
    else if (type === 'IDAT') idat.push(body)
    else if (type === 'IEND') break
    offset += 12 + length
  }
  const channels = CHANNELS[colorType] as number
  const stride = width * channels
  const raw = inflateSync(Buffer.concat(idat))
  const pixels = new Uint8Array(stride * height)
  // Undo the per-row filters (PNG spec section 9).
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const src = y * (stride + 1) + 1
    const dst = y * stride
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? (pixels[dst + x - channels] as number) : 0
      const up = y > 0 ? (pixels[dst - stride + x] as number) : 0
      const upLeft = y > 0 && x >= channels ? (pixels[dst - stride + x - channels] as number) : 0
      let predictor = 0
      if (filter === 1) predictor = left
      else if (filter === 2) predictor = up
      else if (filter === 3) predictor = (left + up) >> 1
      else if (filter === 4) {
        const p = left + up - upLeft
        const pa = Math.abs(p - left)
        const pb = Math.abs(p - up)
        const pc = Math.abs(p - upLeft)
        predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft
      }
      pixels[dst + x] = ((raw[src + x] as number) + predictor) & 0xff
    }
  }
  const data = new Uint8ClampedArray(width * height * 4)
  for (let p = 0; p < width * height; p++) {
    const s = p * channels
    const d = p * 4
    if (colorType === 3) {
      const index = pixels[s] as number
      data[d] = palette[index * 3] ?? 0
      data[d + 1] = palette[index * 3 + 1] ?? 0
      data[d + 2] = palette[index * 3 + 2] ?? 0
      data[d + 3] = transparency[index] ?? 255
    } else if (colorType === 0 || colorType === 4) {
      data[d] = data[d + 1] = data[d + 2] = pixels[s] as number
      data[d + 3] = colorType === 4 ? (pixels[s + 1] as number) : 255
    } else {
      data[d] = pixels[s] as number
      data[d + 1] = pixels[s + 1] as number
      data[d + 2] = pixels[s + 2] as number
      data[d + 3] = colorType === 6 ? (pixels[s + 3] as number) : 255
    }
  }
  return { width, height, data }
}
