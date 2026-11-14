/**
 * Pure helpers for the wallet tile preview (CardPreview.tsx): which motif a
 * barcode gets, and a small seeded PRNG so each card's decorative pattern is
 * stable. No React, so they are unit-tested directly.
 */
import { FORMAT_SPECS } from '../barcodes/formats.ts'
import type { CardBarcode } from '../cards/card.ts'

export type PreviewVariant = 'linear' | 'stacked' | 'qr' | 'matrix' | 'image' | 'text'

export function previewVariant(barcode: CardBarcode): PreviewVariant {
  switch (barcode.kind) {
    case 'image':
      return 'image'
    case 'text':
      return 'text'
    case 'generated':
      if (barcode.format === 'qrcode') return 'qr'
      if (barcode.format === 'pdf417') return 'stacked'
      return FORMAT_SPECS[barcode.format].dimension === '2d' ? 'matrix' : 'linear'
  }
}

/** Small deterministic PRNG (mulberry32) seeded from a string hash (FNV-1a). */
export function seededRandom(seed: string): () => number {
  let h = 0x811c9dc5
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 0x01000193)
  let state = h >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
