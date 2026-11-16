import { describe, expect, it } from 'vitest'
import { CARD_LIMITS, validateBarcode, validateIcon, validateNewCard, validateStoreName } from './card.ts'
import { CARD_ICONS, CARD_ICON_IDS, isCardIconId } from './cardIcons.ts'
import { TILE_COLORS, tileColor } from './tileColors.ts'

describe('card domain', () => {
  it('requires a store name within the limit', () => {
    expect(validateStoreName('  ')).toMatch(/store name/i)
    expect(validateStoreName('x'.repeat(CARD_LIMITS.storeName + 1))).toMatch(/characters/)
    expect(validateStoreName('  Shop  ')).toBeNull()
  })

  it('accepts a minimal valid card', () => {
    expect(
      validateNewCard({ storeName: 'Shop', color: 'red', barcode: { kind: 'generated', format: 'code128', value: '0' } }),
    ).toBeNull()
  })

  it('requires a palette colour', () => {
    expect(
      validateNewCard({ storeName: 'Shop', color: '#ff0000', barcode: { kind: 'text', value: '1' } }),
    ).toMatch(/Choose a tile color\./)
  })

  it('treats a missing icon as None and accepts only the nine supported identifiers', () => {
    expect(CARD_ICON_IDS).toEqual(['fitness', 'grocery', 'fuel', 'hardware', 'food', 'coffee', 'retail', 'events', 'gear'])
    expect(CARD_ICONS.map((icon) => icon.id)).toEqual(CARD_ICON_IDS)
    expect(CARD_ICONS.map((icon) => icon.label)).toEqual(['Fitness', 'Grocery', 'Fuel', 'Hardware', 'Food', 'Coffee', 'Retail', 'Events', 'Gear'])
    expect(validateIcon(undefined)).toBeNull()
    for (const id of CARD_ICON_IDS) expect(validateIcon(id)).toBeNull()
    for (const bad of [null, '', 'none', 'Coffee', 'rocket', 3]) {
      expect(isCardIconId(bad)).toBe(false)
      expect(validateIcon(bad)).toMatch(/icon/)
    }
    const base = { storeName: 'Shop', color: 'red', barcode: { kind: 'text' as const, value: '1' } }
    expect(validateNewCard(base)).toBeNull()
    expect(validateNewCard({ ...base, icon: 'fuel' })).toBeNull()
    expect(validateNewCard({ ...base, icon: 'gear' })).toBeNull()
    for (const color of ['petrol-teal', 'olive', 'dusty-rose']) expect(validateNewCard({ ...base, color })).toBeNull()
    expect(validateNewCard({ ...base, icon: 'rocket' as never })).toMatch(/icon/)
  })

  it('validates barcodes per kind', () => {
    expect(validateBarcode({ kind: 'generated', format: 'upca', value: '012345678905' })).toBeNull()
    expect(validateBarcode({ kind: 'generated', format: 'upca', value: '012345678900' })).toMatch(/check digit/)
    expect(validateBarcode({ kind: 'image', image: new Blob([]) })).toMatch(/missing/)
    expect(validateBarcode({ kind: 'image', image: new Blob(['x']) })).toBeNull()
    expect(validateBarcode({ kind: 'text', value: '' })).toMatch(/missing/)
  })

  it('falls back to the default colour for unknown palette ids', () => {
    expect(tileColor('mystery').label).toBe('Midnight Blue')
    expect(new Set(TILE_COLORS.map((color) => color.id)).size).toBe(TILE_COLORS.length)
  })
})
