#!/usr/bin/env node
/**
 * Generates the M8TRX application icons and the in-app DIM8 logo images.
 *
 * Run with `npm run icons`. The outputs are committed, so this only needs to
 * run when the icon design or the source logo changes. Only Node built-ins
 * are used (zlib for PNG (de)compression), so asset generation adds no
 * dependencies and is reproducible on any machine: no system fonts, image
 * tools or network access are involved, and the same inputs always produce
 * byte-identical outputs.
 *
 * Outputs:
 *   public/favicon.svg                vector favicon (same geometry)
 *   public/pwa-192x192.png            manifest icon, purpose "any" (rounded square)
 *   public/pwa-512x512.png            manifest icon, purpose "any" (rounded square)
 *   public/maskable-icon-512x512.png  manifest icon, purpose "maskable" (full
 *                                     bleed, artwork inside the 80% safe zone)
 *   public/apple-touch-icon.png       180x180 opaque full bleed; iOS applies
 *                                     its own rounded-corner mask
 *   src/assets/brand/dim8-logo-120.png  DIM8 logo for the shared header
 *   src/assets/brand/dim8-logo-240.png  DIM8 logo for the About screen
 *
 * ---- Icon artwork (M8TRX product identity, Iteration 4F) -------------------
 * A dark DIM8 background with a small decorative barcode above the M8TRX
 * lettering, both in the DIM8 primary VFD colour with a faint VFD glow.
 * - The barcode encodes nothing; its bar pattern is fixed below.
 * - The lettering is drawn as geometric strokes defined in this file. It is
 *   deliberately a plain geometric sans in the spirit of the approved DIM8
 *   wordmark stack, NOT an imitation of the (not yet supplied) official
 *   seven-segment font, and it does not depend on any installed font.
 *   When the licensed seven-segment font is supplied, the icon can be
 *   redrawn from it here.
 * - Everything sits inside a circle of radius 0.4 (after MASKABLE_SCALE) so
 *   maskable crops and iOS corner masking never clip it.
 *
 * ---- Logo derivatives -----------------------------------------------------
 * Source: assets/brand/dim8-vfd-logo.png, the official DIM8 logo exactly as
 * supplied (1254x1254 RGB, black canvas). The derivatives are NOT redrawn or
 * recoloured: the surrounding black canvas is trimmed (an equal-margin crop
 * around the visible mark and "DIM8 LABS" lettering) and the image is
 * area-averaged down to a small height, so the logo's proportions and colours
 * are preserved while the app avoids shipping an 860 KB image.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { deflateSync, inflateSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PUBLIC_DIR = join(ROOT, 'public')
const LOGO_SOURCE = join(ROOT, 'assets', 'brand', 'dim8-vfd-logo.png')
const LOGO_OUT_DIR = join(ROOT, 'src', 'assets', 'brand')

// Official DIM8 palette; keep in sync with the --dim8-* tokens in src/styles/tokens.css.
const BG = '#010100'
const VFD = '#b8ddd7'
const VFD_BRIGHT = '#d6f4ef'
const GLOW_RGB = [140, 220, 206]
/** Peak opacity and falloff (icon units) of the VFD glow around strokes and bars. */
const GLOW_ALPHA = 0.38
const GLOW_RADIUS = 0.012

// Geometry in unit coordinates (0..1 of the icon edge, y downwards).
const BACKGROUND_RADIUS = 0.22
// Maskable icons may be cropped to a circle of radius 0.4; shrinking the
// artwork to 80% keeps every corner of the composition inside that zone.
const MASKABLE_SCALE = 0.8

/** Decorative barcode: alternating bar/space widths in modules (bars first). */
const BAR_PATTERN = [2, 1, 1, 1, 1, 2, 3, 1, 1, 1, 2, 2, 1, 1, 1, 3, 2, 1, 1, 1, 3, 1, 1, 2, 1, 1, 2, 1, 1, 1, 2]
/** Guard bars (first two, middle, last two) run slightly longer, like retail barcodes. */
const BARCODE_BOX = { x: 0.24, y: 0.27, w: 0.52, h: 0.17 }
const GUARD_EXTRA = 0.025

/**
 * Lettering. Each glyph is a list of strokes on a cap-height-1 grid
 * (x right, y down, centre-lines): segments [x1, y1, x2, y2] and arcs
 * { cx, cy, r, from, to } with angles in degrees (0 = right, 90 = down).
 */
const GLYPHS = {
  M: { width: 0.9, strokes: [[0, 1, 0, 0], [0, 0, 0.45, 0.62], [0.45, 0.62, 0.9, 0], [0.9, 0, 0.9, 1]] },
  8: {
    width: 0.6,
    strokes: [
      { cx: 0.3, cy: 0.25, r: 0.23, from: 0, to: 360 },
      { cx: 0.3, cy: 0.735, r: 0.265, from: 0, to: 360 },
    ],
  },
  T: { width: 0.76, strokes: [[0, 0, 0.76, 0], [0.38, 0, 0.38, 1]] },
  R: {
    width: 0.66,
    strokes: [[0, 1, 0, 0], [0, 0, 0.38, 0], { cx: 0.38, cy: 0.25, r: 0.25, from: -90, to: 90 }, [0.38, 0.5, 0, 0.5], [0.32, 0.5, 0.66, 1]],
  },
  X: { width: 0.76, strokes: [[0, 0, 0.76, 1], [0.76, 0, 0, 1]] },
}
const WORD = 'M8TRX'
const LETTER_GAP = 0.26 // in cap heights
const TEXT_BOX = { x: 0.18, y: 0.555, w: 0.64 } // cap height follows from the width
const STROKE_RATIO = 0.15 // stroke width / cap height

// Supersampling factor per axis for anti-aliased edges.
const SAMPLES = 4

// ---- Scene description ------------------------------------------------------

function wordStrokes() {
  const glyphs = [...WORD].map((ch) => GLYPHS[ch])
  const totalWidth = glyphs.reduce((sum, g) => sum + g.width, 0) + LETTER_GAP * (glyphs.length - 1)
  const cap = TEXT_BOX.w / totalWidth
  const strokes = []
  let x = TEXT_BOX.x
  for (const glyph of glyphs) {
    for (const s of glyph.strokes) {
      if (Array.isArray(s)) {
        strokes.push({ type: 'line', x1: x + s[0] * cap, y1: TEXT_BOX.y + s[1] * cap, x2: x + s[2] * cap, y2: TEXT_BOX.y + s[3] * cap })
      } else {
        strokes.push({ type: 'arc', cx: x + s.cx * cap, cy: TEXT_BOX.y + s.cy * cap, r: s.r * cap, from: s.from, to: s.to })
      }
    }
    x += (glyph.width + LETTER_GAP) * cap
  }
  return { strokes, width: cap * STROKE_RATIO }
}

function barcodeBars() {
  const modules = BAR_PATTERN.reduce((sum, n) => sum + n, 0)
  const unit = BARCODE_BOX.w / modules
  const bars = []
  let x = BARCODE_BOX.x
  const barCount = Math.ceil(BAR_PATTERN.length / 2)
  BAR_PATTERN.forEach((n, i) => {
    if (i % 2 === 0) {
      const index = i / 2
      const guard = index < 2 || index >= barCount - 2 || index === Math.floor(barCount / 2)
      bars.push({ x, y: BARCODE_BOX.y, w: n * unit, h: BARCODE_BOX.h + (guard ? GUARD_EXTRA : 0), color: guard ? VFD_BRIGHT : VFD })
    }
    x += n * unit
  })
  return bars
}

/** Scales a point/shape about the icon centre (for the maskable variant). */
function scaleScene(scene, scale) {
  const p = (v) => 0.5 + (v - 0.5) * scale
  return {
    bars: scene.bars.map((b) => ({ ...b, x: p(b.x), y: p(b.y), w: b.w * scale, h: b.h * scale })),
    strokes: scene.strokes.map((s) =>
      s.type === 'line'
        ? { ...s, x1: p(s.x1), y1: p(s.y1), x2: p(s.x2), y2: p(s.y2) }
        : { ...s, cx: p(s.cx), cy: p(s.cy), r: s.r * scale },
    ),
    strokeWidth: scene.strokeWidth * scale,
  }
}

function buildScene(scale) {
  const { strokes, width } = wordStrokes()
  return scaleScene({ bars: barcodeBars(), strokes, strokeWidth: width }, scale)
}

// ---- Geometry helpers ---------------------------------------------------------

function distanceToSegment(px, py, { x1, y1, x2, y2 }) {
  const dx = x2 - x1
  const dy = y2 - y1
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))
}

function distanceToArc(px, py, { cx, cy, r, from, to }) {
  const angle = (Math.atan2(py - cy, px - cx) * 180) / Math.PI
  const full = to - from >= 360
  const inRange = full || [angle, angle + 360, angle - 360].some((a) => a >= from && a <= to)
  if (inRange) return Math.abs(Math.hypot(px - cx, py - cy) - r)
  const end = (deg) => [cx + r * Math.cos((deg * Math.PI) / 180), cy + r * Math.sin((deg * Math.PI) / 180)]
  const [ax, ay] = end(from)
  const [bx, by] = end(to)
  return Math.min(Math.hypot(px - ax, py - ay), Math.hypot(px - bx, py - by))
}

/** Distance from a point to a rectangle (0 inside). */
function distanceToRect(px, py, { x, y, w, h }) {
  const dx = Math.max(x - px, 0, px - (x + w))
  const dy = Math.max(y - py, 0, py - (y + h))
  return Math.hypot(dx, dy)
}

function insideRoundedRect(px, py, { x, y, w, h, r }) {
  if (px < x || px > x + w || py < y || py > y + h) return false
  const cx = Math.min(Math.max(px, x + r), x + w - r)
  const cy = Math.min(Math.max(py, y + r), y + h - r)
  return (px - cx) ** 2 + (py - cy) ** 2 <= r * r
}

function hexToRgb(hex) {
  const n = Number.parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t)

// ---- Icon rasteriser ----------------------------------------------------------

/** Colour of one sample point, or null when it lies outside the icon shape. */
function shade(ux, uy, scene, roundedBackground) {
  if (roundedBackground && !insideRoundedRect(ux, uy, { x: 0, y: 0, w: 1, h: 1, r: BACKGROUND_RADIUS })) return null
  let color = hexToRgb(BG)
  let nearest = Infinity
  for (const bar of scene.bars) {
    const d = distanceToRect(ux, uy, bar)
    if (d === 0) return hexToRgb(bar.color)
    nearest = Math.min(nearest, d)
  }
  const half = scene.strokeWidth / 2
  for (const s of scene.strokes) {
    const d = (s.type === 'line' ? distanceToSegment(ux, uy, s) : distanceToArc(ux, uy, s)) - half
    if (d <= 0) return hexToRgb(VFD)
    nearest = Math.min(nearest, d)
  }
  // Soft VFD glow just outside the lit shapes.
  return mix(color, GLOW_RGB, GLOW_ALPHA * Math.exp(-nearest / GLOW_RADIUS))
}

/** Rasterises the scene into straight (non-premultiplied) RGBA pixels. */
function rasteriseIcon(size, { roundedBackground, scale }) {
  const scene = buildScene(scale)
  const rgba = Buffer.alloc(size * size * 4)
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let sum = [0, 0, 0]
      let hits = 0
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const c = shade((px + (sx + 0.5) / SAMPLES) / size, (py + (sy + 0.5) / SAMPLES) / size, scene, roundedBackground)
          if (!c) continue
          sum = sum.map((v, i) => v + c[i])
          hits += 1
        }
      }
      const i = (py * size + px) * 4
      if (hits > 0) {
        rgba[i] = Math.round(sum[0] / hits)
        rgba[i + 1] = Math.round(sum[1] / hits)
        rgba[i + 2] = Math.round(sum[2] / hits)
        rgba[i + 3] = Math.round((hits / (SAMPLES * SAMPLES)) * 255)
      }
    }
  }
  return rgba
}

function iconSvg() {
  const scene = buildScene(1)
  const f = (v) => Number((v * 100).toFixed(2))
  const bars = scene.bars.map((b) => `<rect x="${f(b.x)}" y="${f(b.y)}" width="${f(b.w)}" height="${f(b.h)}" fill="${b.color}"/>`)
  const paths = scene.strokes.map((s) => {
    if (s.type === 'line') return `M${f(s.x1)} ${f(s.y1)}L${f(s.x2)} ${f(s.y2)}`
    if (s.to - s.from >= 360) {
      return `M${f(s.cx - s.r)} ${f(s.cy)}a${f(s.r)} ${f(s.r)} 0 1 0 ${f(2 * s.r)} 0a${f(s.r)} ${f(s.r)} 0 1 0 ${f(-2 * s.r)} 0`
    }
    const pt = (deg) => [s.cx + s.r * Math.cos((deg * Math.PI) / 180), s.cy + s.r * Math.sin((deg * Math.PI) / 180)]
    const [ax, ay] = pt(s.from)
    const [bx, by] = pt(s.to)
    return `M${f(ax)} ${f(ay)}A${f(s.r)} ${f(s.r)} 0 0 1 ${f(bx)} ${f(by)}`
  })
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">',
    `  <rect width="100" height="100" rx="${f(BACKGROUND_RADIUS)}" fill="${BG}"/>`,
    `  ${bars.join('')}`,
    `  <path d="${paths.join('')}" fill="none" stroke="${VFD}" stroke-width="${f(scene.strokeWidth)}" stroke-linecap="round" stroke-linejoin="round"/>`,
    '</svg>',
    '',
  ].join('\n')
}

// ---- Minimal PNG codec (8-bit, non-interlaced) --------------------------------
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(buf) {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

/** Encodes RGBA pixels (width x height) as a PNG. */
function encodePng(width, height, rgba) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8 // bit depth
  header[9] = 6 // colour type: RGBA
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0 // filter type: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** Decodes an 8-bit RGB/RGBA non-interlaced PNG (the supplied logo's format) to RGBA. */
function decodePng(buffer) {
  let offset = 8
  let width = 0
  let height = 0
  let channels = 0
  const idat = []
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const data = buffer.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      const [depth, colorType, , , interlace] = data.subarray(8)
      if (depth !== 8 || interlace !== 0 || (colorType !== 2 && colorType !== 6)) {
        throw new Error('Unsupported logo PNG: expected 8-bit, non-interlaced RGB or RGBA.')
      }
      channels = colorType === 6 ? 4 : 3
    } else if (type === 'IDAT') idat.push(data)
    offset += 12 + length
  }
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const pixels = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    for (let x = 0; x < stride; x++) {
      const value = raw[y * (stride + 1) + 1 + x]
      const a = x >= channels ? pixels[y * stride + x - channels] : 0
      const b = y > 0 ? pixels[(y - 1) * stride + x] : 0
      const c = x >= channels && y > 0 ? pixels[(y - 1) * stride + x - channels] : 0
      let predictor = 0
      if (filter === 1) predictor = a
      else if (filter === 2) predictor = b
      else if (filter === 3) predictor = (a + b) >> 1
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      pixels[y * stride + x] = (value + predictor) & 255
    }
  }
  const rgba = Buffer.alloc(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = pixels[i * channels]
    rgba[i * 4 + 1] = pixels[i * channels + 1]
    rgba[i * 4 + 2] = pixels[i * channels + 2]
    rgba[i * 4 + 3] = channels === 4 ? pixels[i * channels + 3] : 255
  }
  return { width, height, rgba }
}

// ---- Logo derivatives ---------------------------------------------------------

/** Pixels brighter than this (max channel) count as part of the logo, not canvas. */
const LOGO_TRIM_THRESHOLD = 32
/** Black margin kept around the trimmed mark, as a fraction of its height. */
const LOGO_MARGIN = 0.04

/** Bounding box of the visible logo, padded by an equal margin on every side. */
function logoBounds({ width, height, rgba }) {
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      if (Math.max(rgba[i], rgba[i + 1], rgba[i + 2]) > LOGO_TRIM_THRESHOLD) {
        minX = Math.min(minX, x)
        maxX = Math.max(maxX, x)
        minY = Math.min(minY, y)
        maxY = Math.max(maxY, y)
      }
    }
  }
  const margin = Math.round((maxY - minY + 1) * LOGO_MARGIN)
  const x = Math.max(0, minX - margin)
  const y = Math.max(0, minY - margin)
  return { x, y, w: Math.min(width, maxX + margin + 1) - x, h: Math.min(height, maxY + margin + 1) - y }
}

/** Area-averaging downscale of a crop to `outHeight` rows (aspect ratio kept). */
function downscale({ width, rgba }, crop, outHeight) {
  const outWidth = Math.round((crop.w * outHeight) / crop.h)
  const sx = crop.w / outWidth
  const sy = crop.h / outHeight
  const out = Buffer.alloc(outWidth * outHeight * 4)
  for (let oy = 0; oy < outHeight; oy++) {
    for (let ox = 0; ox < outWidth; ox++) {
      const x0 = crop.x + ox * sx
      const y0 = crop.y + oy * sy
      const sum = [0, 0, 0, 0]
      let weight = 0
      for (let y = Math.floor(y0); y < Math.ceil(y0 + sy); y++) {
        const wy = Math.min(y + 1, y0 + sy) - Math.max(y, y0)
        for (let x = Math.floor(x0); x < Math.ceil(x0 + sx); x++) {
          const w = wy * (Math.min(x + 1, x0 + sx) - Math.max(x, x0))
          const i = (y * width + x) * 4
          for (let c = 0; c < 4; c++) sum[c] += rgba[i + c] * w
          weight += w
        }
      }
      const o = (oy * outWidth + ox) * 4
      for (let c = 0; c < 4; c++) out[o + c] = Math.round(sum[c] / weight)
    }
  }
  return { width: outWidth, height: outHeight, rgba: out }
}

// ---- Main ---------------------------------------------------------------------

const icons = [
  { file: 'pwa-192x192.png', size: 192, roundedBackground: true, scale: 1 },
  { file: 'pwa-512x512.png', size: 512, roundedBackground: true, scale: 1 },
  { file: 'maskable-icon-512x512.png', size: 512, roundedBackground: false, scale: MASKABLE_SCALE },
  { file: 'apple-touch-icon.png', size: 180, roundedBackground: false, scale: 1 },
]

for (const { file, size, ...options } of icons) {
  writeFileSync(join(PUBLIC_DIR, file), encodePng(size, size, rasteriseIcon(size, options)))
  console.log(`wrote public/${file}`)
}
writeFileSync(join(PUBLIC_DIR, 'favicon.svg'), iconSvg())
console.log('wrote public/favicon.svg')

const logo = decodePng(readFileSync(LOGO_SOURCE))
const crop = logoBounds(logo)
for (const height of [120, 240]) {
  const scaled = downscale(logo, crop, height)
  const file = `dim8-logo-${height}.png`
  writeFileSync(join(LOGO_OUT_DIR, file), encodePng(scaled.width, scaled.height, scaled.rgba))
  console.log(`wrote src/assets/brand/${file} (${scaled.width}x${scaled.height}, crop ${crop.w}x${crop.h}@${crop.x},${crop.y})`)
}
