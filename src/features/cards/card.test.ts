import { describe, expect, it } from 'vitest'
import { CARD_LIMITS, validateBarcode, validateNewCard, validateStoreName } from './card.ts'
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
    ).toMatch(/colour/)
  })

  it('validates barcodes per kind', () => {
    expect(validateBarcode({ kind: 'generated', format: 'upca', value: '012345678905' })).toBeNull()
    expect(validateBarcode({ kind: 'generated', format: 'upca', value: '012345678900' })).toMatch(/check digit/)
    expect(validateBarcode({ kind: 'image', image: new Blob([]) })).toMatch(/missing/)
    expect(validateBarcode({ kind: 'image', image: new Blob(['x']) })).toBeNull()
    expect(validateBarcode({ kind: 'text', value: '' })).toMatch(/missing/)
  })

  it('falls back to the default colour for unknown palette ids', () => {
    expect(tileColor('mystery').id).toBe('blue')
    expect(new Set(TILE_COLORS.map((color) => color.id)).size).toBe(TILE_COLORS.length)
  })
})
