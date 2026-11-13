#!/usr/bin/env node
/**
 * Generates the application icons in public/ from the geometry defined below.
 *
 * Run with `npm run icons`. The outputs are committed, so this only needs to
 * run when the icon design changes. The script uses only Node built-ins (zlib
 * for PNG compression) so icon generation adds no dependencies.
 *
 * Outputs:
 *   favicon.svg                 vector favicon (same geometry)
 *   pwa-192x192.png             manifest icon, purpose "any" (rounded square)
 *   pwa-512x512.png             manifest icon, purpose "any" (rounded square)
 *   maskable-icon-512x512.png   manifest icon, purpose "maskable" (full bleed,
 *                               artwork inside the 80% safe-zone circle)
 *   apple-touch-icon.png        180x180 opaque full bleed; iOS applies its own mask
 *
 * The artwork is a placeholder: a stylised card on the accent colour. Replace
 * the geometry/colours here if authoritative DIM8 brand assets are supplied.
 */
import { writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')

// Keep in sync with --color-accent in src/styles/tokens.css.
const ACCENT = '#1f4fd8'
const CARD = '#ffffff'
const DETAIL = '#9db2f0'

// Geometry in unit coordinates (0..1 of the icon edge).
const BACKGROUND_RADIUS = 0.22
const CARD_BOX = { x: 0.2, y: 0.31, w: 0.6, h: 0.38, r: 0.06 }
const STRIPE = { y: 0.4, h: 0.07 }
const DETAIL_BAR = { x: 0.27, y: 0.56, w: 0.2, h: 0.05, r: 0.025 }
// Maskable icons may be cropped to a circle of radius 0.4; shrinking the
// artwork to 80% keeps every card corner inside that safe zone.
const MASKABLE_SCALE = 0.8

// Supersampling factor per axis for anti-aliased edges.
const SAMPLES = 4

/** Layers drawn bottom to top. Each is a rounded rectangle with a colour. */
function layers({ roundedBackground, scale }) {
  const s = (rect) => {
    const cx = 0.5
    const cy = 0.5
    return {
      x: cx + (rect.x - cx) * scale,
      y: cy + (rect.y - cy) * scale,
      w: rect.w * scale,
      h: rect.h * scale,
      r: (rect.r ?? 0) * scale,
    }
  }
  const card = s(CARD_BOX)
  return [
    { color: ACCENT, rect: { x: 0, y: 0, w: 1, h: 1, r: roundedBackground ? BACKGROUND_RADIUS : 0 } },
    { color: CARD, rect: card },
    // The stripe spans the card width and lies between the card's rounded
    // corners (vertically), so square ends match the card edge exactly.
    { color: ACCENT, rect: s({ x: CARD_BOX.x, y: STRIPE.y, w: CARD_BOX.w, h: STRIPE.h }) },
    { color: DETAIL, rect: s(DETAIL_BAR) },
  ]
}

function insideRoundedRect(px, py, { x, y, w, h, r }) {
  if (px < x || px > x + w || py < y || py > y + h) return false
  const cx = Math.min(Math.max(px, x + r), x + w - r)
  const cy = Math.min(Math.max(py, y + r), y + h - r)
  const dx = px - cx
  const dy = py - cy
  return dx * dx + dy * dy <= r * r
}

function hexToRgb(hex) {
  const n = Number.parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** Rasterises the layers into straight (non-premultiplied) RGBA pixels. */
function rasterise(size, layerList) {
  const rgba = Buffer.alloc(size * size * 4)
  const parsed = layerList.map((l) => ({ rgb: hexToRgb(l.color), rect: l.rect }))
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const ux = (px + (sx + 0.5) / SAMPLES) / size
          const uy = (py + (sy + 0.5) / SAMPLES) / size
          let hit = null
          for (const layer of parsed) {
            if (insideRoundedRect(ux, uy, layer.rect)) hit = layer.rgb
          }
          if (hit) {
            r += hit[0]
            g += hit[1]
            b += hit[2]
            a += 1
          }
        }
      }
      const i = (py * size + px) * 4
      if (a > 0) {
        rgba[i] = Math.round(r / a)
        rgba[i + 1] = Math.round(g / a)
        rgba[i + 2] = Math.round(b / a)
        rgba[i + 3] = Math.round((a / (SAMPLES * SAMPLES)) * 255)
      }
    }
  }
  return rgba
}

// ---- Minimal PNG encoder (8-bit RGBA, no interlace) -------------------------
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

function encodePng(size, rgba) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8 // bit depth
  header[9] = 6 // colour type: RGBA
  // bytes 10-12: compression, filter, interlace = 0
  const stride = size * 4
  const raw = Buffer.alloc((stride + 1) * size)
  for (let y = 0; y < size; y++) {
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

function svg(layerList) {
  const fmt = (v) => Number((v * 100).toFixed(2))
  const shapes = layerList
    .map(({ color, rect }) => {
      const rx = rect.r ? ` rx="${fmt(rect.r)}"` : ''
      return `  <rect x="${fmt(rect.x)}" y="${fmt(rect.y)}" width="${fmt(rect.w)}" height="${fmt(rect.h)}"${rx} fill="${color}"/>`
    })
    .join('\n')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">\n${shapes}\n</svg>\n`
}

const outputs = [
  { file: 'pwa-192x192.png', size: 192, roundedBackground: true, scale: 1 },
  { file: 'pwa-512x512.png', size: 512, roundedBackground: true, scale: 1 },
  { file: 'maskable-icon-512x512.png', size: 512, roundedBackground: false, scale: MASKABLE_SCALE },
  { file: 'apple-touch-icon.png', size: 180, roundedBackground: false, scale: 1 },
]

for (const { file, size, ...options } of outputs) {
  writeFileSync(join(OUT_DIR, file), encodePng(size, rasterise(size, layers(options))))
  console.log(`wrote public/${file}`)
}
writeFileSync(join(OUT_DIR, 'favicon.svg'), svg(layers({ roundedBackground: true, scale: 1 })))
console.log('wrote public/favicon.svg')
