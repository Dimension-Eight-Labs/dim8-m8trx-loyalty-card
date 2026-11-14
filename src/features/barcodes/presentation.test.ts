/** Unit tests for the checkout face-shape rule (barcodes/presentation.ts). */
import { describe, expect, it } from 'vitest'
import { BARCODE_FORMATS, FORMAT_SPECS } from './formats.ts'
import { checkoutPresentation } from './presentation.ts'

const image = (detectedFormat?: string) => ({ kind: 'image' as const, image: new Blob(['x']), ...(detectedFormat ? { detectedFormat } : {}) })

describe('checkoutPresentation', () => {
  it('classifies every supported format: square symbols, PDF417 apart, linear compact', () => {
    const expected: Record<string, string> = { qrcode: 'square', datamatrix: 'square', azteccode: 'square', pdf417: 'stacked' }
    for (const format of BARCODE_FORMATS) {
      expect(checkoutPresentation({ kind: 'generated', format, value: '1' }), format).toBe(expected[format] ?? 'card')
      // Imported artwork with the same detected format gets the same shape.
      expect(checkoutPresentation(image(FORMAT_SPECS[format].label)), `image ${format}`).toBe(expected[format] ?? 'card')
    }
  })

  it('never treats PDF417 as QR', () => {
    expect(checkoutPresentation({ kind: 'generated', format: 'pdf417', value: 'X' })).toBe('stacked')
    expect(checkoutPresentation(image('PDF417'))).toBe('stacked')
  })

  it('keeps unknown or unsupported imported images on the default card face', () => {
    expect(checkoutPresentation(image())).toBe('card')
    expect(checkoutPresentation(image('Codabar'))).toBe('card')
    expect(checkoutPresentation(image('MaxiCode'))).toBe('card')
    expect(checkoutPresentation(image(''))).toBe('card')
  })

  it('matches stored labels case- and whitespace-insensitively', () => {
    expect(checkoutPresentation(image(' qr CODE '))).toBe('square')
  })

  it('uses the default face for text-only cards', () => {
    expect(checkoutPresentation({ kind: 'text', value: '123' })).toBe('card')
  })
})
