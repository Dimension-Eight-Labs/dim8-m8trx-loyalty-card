/**
 * Palette contrast check. Wallet tiles put the store name in `text` on
 * `background` (checkout only uses `background` for the card's thin bands
 * since v0.4.1); every pair must meet WCAG 2.x AA
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

/*
 * The one authoritative foreground per color (v0.6.1 consistency pass). Card
 * names and category icons on every card surface inherit this value; the
 * light colors use charcoal and the dark ones white. Pinned exactly so a
 * palette edit cannot silently flip a title or icon color.
 */
const EXPECTED_FOREGROUND: Record<string, string> = {
  red: '#ffffff',
  orange: '#1a1a1a',
  yellow: '#1a1a1a',
  green: '#ffffff',
  teal: '#ffffff',
  blue: '#ffffff',
  indigo: '#ffffff',
  purple: '#ffffff',
  pink: '#ffffff',
  brown: '#ffffff',
  slate: '#ffffff',
  white: '#1a1a1a',
}

describe('tile palette foreground', () => {
  it('has exactly the 12 existing color ids, in order', () => {
    expect(TILE_COLORS.map((c) => c.id)).toEqual(Object.keys(EXPECTED_FOREGROUND))
  })

  it.each(TILE_COLORS.filter((c) => ['orange', 'yellow', 'white'].includes(c.id)).map((c) => [c.label, c] as const))(
    'light tile %s uses the charcoal foreground',
    (_label, color) => {
      expect(color.text).toBe('#1a1a1a')
    },
  )

  it.each(TILE_COLORS.filter((c) => !['orange', 'yellow', 'white'].includes(c.id)).map((c) => [c.label, c] as const))(
    'dark tile %s uses the white foreground',
    (_label, color) => {
      expect(color.text).toBe('#ffffff')
    },
  )

  it('matches the pinned mapping for every color', () => {
    expect(Object.fromEntries(TILE_COLORS.map((c) => [c.id, c.text]))).toEqual(EXPECTED_FOREGROUND)
  })
})

describe('tile palette', () => {
  it.each(TILE_COLORS.map((c) => [c.label, c] as const))('%s text meets 4.5:1 on its background', (_label, color) => {
    expect(contrast(color.text, color.background)).toBeGreaterThanOrEqual(4.5)
  })
})
