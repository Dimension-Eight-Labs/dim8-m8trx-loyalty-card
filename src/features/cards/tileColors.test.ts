/**
 * Palette contract for the approved DIM8 industrial metallic palette.
 *
 * Pins every entry exactly — legacy persistence id, approved name, background
 * and foreground, in approved order — so a palette edit cannot silently
 * rename a colour, change a hex value, reorder the picker or flip a title /
 * icon colour. Contrast is computed here from the hex values rather than
 * trusted from comments.
 */
import { describe, expect, it } from 'vitest'
import { CHARCOAL, DEFAULT_TILE_COLOR_ID, SOFT_SILVER, TILE_COLORS, colorForIndex, isTileColorId, tileColor } from './tileColors.ts'

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
 * Approved palette, in approved order. The ids are the legacy keys retained
 * from the pre-0.6.1 bright palette (stored cards and old backups keep using
 * them); the mapping was approved in planning.
 */
const APPROVED: ReadonlyArray<readonly [id: string, label: string, background: string, text: string]> = [
  ['blue', 'Gunmetal', '#414A52', '#E8ECEB'],
  ['teal', 'Brushed Steel', '#727F89', '#E8ECEB'],
  ['brown', 'Obsidian Black', '#1F2124', '#E8ECEB'],
  ['orange', 'Copper', '#A26443', '#E8ECEB'],
  ['green', 'Deep Emerald', '#235C52', '#E8ECEB'],
  ['indigo', 'Midnight Blue', '#244669', '#E8ECEB'],
  ['pink', 'Burgundy', '#723B4B', '#E8ECEB'],
  ['slate', 'Graphite', '#34383D', '#E8ECEB'],
  ['red', 'Oxblood Red', '#892F32', '#E8ECEB'],
  ['yellow', 'Antique Gold', '#9B7B20', '#E8ECEB'],
  ['white', 'Ivory', '#E5E0D1', '#1A1A1A'],
  ['purple', 'Deep Violet', '#51436C', '#E8ECEB'],
]

/** The pre-0.6.1 identifier set; every one must still resolve to itself. */
const LEGACY_IDS = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'indigo', 'purple', 'pink', 'brown', 'slate', 'white']

describe('approved industrial palette', () => {
  it('has exactly twelve entries', () => {
    expect(TILE_COLORS).toHaveLength(12)
  })

  it('matches the approved ids, names, hex values, foregrounds and order exactly', () => {
    expect(TILE_COLORS.map((c) => [c.id, c.label, c.background, c.text])).toEqual(APPROVED)
  })

  it('uses the exact Soft Silver and Charcoal foregrounds (never pure white)', () => {
    expect(SOFT_SILVER).toBe('#E8ECEB')
    expect(CHARCOAL).toBe('#1A1A1A')
    for (const color of TILE_COLORS) expect(color.text.toLowerCase()).not.toBe('#ffffff')
  })

  it('gives Ivory the Charcoal foreground', () => {
    expect(TILE_COLORS.filter((c) => c.text === CHARCOAL).map((c) => c.label)).toEqual(['Ivory'])
  })

  it.each(TILE_COLORS.filter((c) => c.label !== 'Ivory').map((c) => [c.label, c] as const))(
    '%s uses the Soft Silver foreground',
    (_label, color) => {
      expect(color.text).toBe(SOFT_SILVER)
    },
  )
})

describe('legacy color identifiers', () => {
  it('retains exactly the pre-0.6.1 id set, so stored cards and old backups stay valid', () => {
    expect(TILE_COLORS.map((c) => c.id).sort()).toEqual([...LEGACY_IDS].sort())
  })

  it.each(LEGACY_IDS)('stored id %s is valid and renders its own palette entry', (id) => {
    expect(isTileColorId(id)).toBe(true)
    expect(tileColor(id).id).toBe(id)
  })

  it('falls back to Midnight Blue for unknown ids', () => {
    expect(DEFAULT_TILE_COLOR_ID).toBe('indigo')
    expect(tileColor('chartreuse').label).toBe('Midnight Blue')
    expect(isTileColorId('chartreuse')).toBe(false)
  })

  it('cycles default colours through the approved order', () => {
    expect(Array.from({ length: 13 }, (_, i) => colorForIndex(i))).toEqual([...APPROVED.map(([id]) => id), 'blue'])
  })
})

/*
 * Contrast (WCAG 2.x relative luminance). Three locked combinations fall
 * below the 4.5:1 normal-text level; they are approved by the owner and
 * reported as a contrast concern rather than corrected. Every pair must still
 * reach 3:1 (graphical objects such as the category icon and check mark, and
 * large text). If a palette edit changes these, this test forces the
 * exception list to be revisited.
 */
const BELOW_NORMAL_TEXT_AA: Record<string, number> = {
  'Brushed Steel': 3.45,
  Copper: 3.97,
  'Antique Gold': 3.36,
}

describe('palette contrast', () => {
  it.each(TILE_COLORS.map((c) => [c.label, c] as const))('%s foreground reaches 3:1 on its background', (_label, color) => {
    expect(contrast(color.text, color.background)).toBeGreaterThanOrEqual(3)
  })

  it.each(TILE_COLORS.filter((c) => !(c.label in BELOW_NORMAL_TEXT_AA)).map((c) => [c.label, c] as const))(
    '%s foreground meets 4.5:1 on its background',
    (_label, color) => {
      expect(contrast(color.text, color.background)).toBeGreaterThanOrEqual(4.5)
    },
  )

  it.each(Object.entries(BELOW_NORMAL_TEXT_AA))('%s is a recorded below-4.5:1 exception at %s:1', (label, ratio) => {
    const color = TILE_COLORS.find((c) => c.label === label)!
    const measured = contrast(color.text, color.background)
    expect(measured).toBeLessThan(4.5)
    expect(measured).toBeCloseTo(ratio, 2)
  })
})
