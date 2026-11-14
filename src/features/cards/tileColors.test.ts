/**
 * Palette contrast check. Tiles and the checkout header band both put the
 * store name in `text` on `background`; every pair must meet WCAG 2.x AA
 * (4.5:1) — computed here from the hex values rather than trusted from comments.
 */
import { describe, expect, it } from 'vitest'
import { TILE_COLORS } from './tileColors.ts'

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

describe('tile palette', () => {
  it.each(TILE_COLORS.map((c) => [c.label, c] as const))('%s text meets 4.5:1 on its background', (_label, color) => {
    expect(contrast(color.text, color.background)).toBeGreaterThanOrEqual(4.5)
  })
})
