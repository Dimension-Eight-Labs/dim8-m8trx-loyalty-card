/**
 * Wallet tile preview tests (host/jsdom). They check which motif each barcode
 * kind gets, that the preview is decorative and never encodes the card value,
 * and that stored artwork object URLs are revoked. Visual appearance is
 * checked separately in a browser; jsdom does not lay out or paint.
 */
import { render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CARD_SCHEMA_VERSION, type CardBarcode, type LoyaltyCard } from '../cards/card.ts'
import { CardPreview } from './CardPreview.tsx'
import { previewVariant, seededRandom } from './previewMotif.ts'
import { CardTile } from './CardTile.tsx'

function card(barcode: CardBarcode, overrides: Partial<LoyaltyCard> = {}): LoyaltyCard {
  return {
    id: 'card-1',
    schemaVersion: CARD_SCHEMA_VERSION,
    storeName: 'Corner Coffee',
    color: 'green',
    barcode,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('previewVariant', () => {
  it('maps every barcode kind and format to a motif', () => {
    expect(previewVariant({ kind: 'generated', format: 'code128', value: '1' })).toBe('linear')
    expect(previewVariant({ kind: 'generated', format: 'ean13', value: '4006381333931' })).toBe('linear')
    expect(previewVariant({ kind: 'generated', format: 'qrcode', value: 'x' })).toBe('qr')
    expect(previewVariant({ kind: 'generated', format: 'datamatrix', value: 'x' })).toBe('matrix')
    expect(previewVariant({ kind: 'generated', format: 'azteccode', value: 'x' })).toBe('matrix')
    expect(previewVariant({ kind: 'generated', format: 'pdf417', value: 'x' })).toBe('stacked')
    expect(previewVariant({ kind: 'image', image: new Blob(['x']) })).toBe('image')
    expect(previewVariant({ kind: 'text', value: '000123' })).toBe('text')
  })

  it('derives patterns deterministically from the seed', () => {
    const a = seededRandom('card-1')
    const b = seededRandom('card-1')
    const c = seededRandom('card-2')
    const first = [a(), a(), a()]
    expect([b(), b(), b()]).toEqual(first)
    expect([c(), c(), c()]).not.toEqual(first)
    expect(first.every((n) => n >= 0 && n < 1)).toBe(true)
  })
})

describe('CardPreview', () => {
  it('draws a decorative bar motif for linear codes, independent of the value', () => {
    const { container: one } = render(<CardPreview card={card({ kind: 'generated', format: 'code128', value: '0012' })} />)
    const { container: two } = render(<CardPreview card={card({ kind: 'generated', format: 'code128', value: '9999 different' })} />)
    const preview = one.querySelector('[data-preview]')!
    expect(preview).toHaveAttribute('data-preview', 'linear')
    expect(preview).toHaveAttribute('aria-hidden', 'true')
    expect(preview.querySelectorAll('rect').length).toBeGreaterThan(10)
    // Same card id, different values → identical motif: the value is never encoded.
    expect(two.querySelector('svg')!.innerHTML).toBe(one.querySelector('svg')!.innerHTML)
    expect(one.textContent).not.toContain('0012')
  })

  it('draws a QR-style grid with three finder squares for QR codes', () => {
    const { container } = render(<CardPreview card={card({ kind: 'generated', format: 'qrcode', value: 'x' })} />)
    expect(container.querySelector('[data-preview="qr"]')).toBeInTheDocument()
    expect(container.querySelectorAll('[data-finder]')).toHaveLength(3)
  })

  it('shows a neutral motif for migrated number-only cards, without the number', () => {
    const { container } = render(<CardPreview card={card({ kind: 'text', value: '000123' })} />)
    expect(container.querySelector('[data-preview="text"]')).toBeInTheDocument()
    expect(container.textContent).not.toContain('000123')
  })

  it('shows stored artwork through an object URL and revokes it on unmount', () => {
    const create = vi.fn(() => 'blob:artwork')
    const revoke = vi.fn()
    vi.stubGlobal('URL', Object.assign(Object.create(URL), { createObjectURL: create, revokeObjectURL: revoke }))
    const image = new Blob(['png'], { type: 'image/png' })
    const { container, unmount } = render(<CardPreview card={card({ kind: 'image', image })} />)

    const img = container.querySelector('img')!
    expect(img).toHaveAttribute('src', 'blob:artwork')
    expect(img).toHaveAttribute('alt', '')
    expect(create).toHaveBeenCalledWith(image)
    unmount()
    expect(revoke).toHaveBeenCalledWith('blob:artwork')
  })

  it('falls back to a grid motif for artwork when object URLs are unavailable', () => {
    vi.stubGlobal('URL', Object.assign(Object.create(URL), { createObjectURL: undefined }))
    const { container } = render(<CardPreview card={card({ kind: 'image', image: new Blob(['png']) })} />)
    expect(container.querySelector('[data-preview="image"] svg')).toBeInTheDocument()
    expect(container.querySelector('img')).not.toBeInTheDocument()
  })
})

describe('CardTile with preview', () => {
  it('keeps the store name as the only accessible name and passes the accent colour', () => {
    const { getByRole, container } = render(
      <ul>
        <CardTile card={card({ kind: 'generated', format: 'qrcode', value: 'x' })} onOpen={() => {}} onOpenMenu={() => {}} />
      </ul>,
    )
    expect(getByRole('button', { name: 'Corner Coffee' })).toBeInTheDocument()
    const tile = container.querySelector('li')!
    expect(tile.style.getPropertyValue('--tile-accent')).toBe('#2e7d32')
    expect(tile).toHaveStyle({ background: '#2e7d32', color: '#ffffff' })
    expect(tile.querySelector('.card-preview')).toBeInTheDocument()
  })
})
