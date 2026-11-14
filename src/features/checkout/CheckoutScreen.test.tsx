/**
 * Component tests for the checkout layout (v0.4.2): which card-face shape
 * each barcode gets, and how the name, card and pagination are arranged.
 * Rendered directly with in-memory cards so imported-image cards (whose Blobs
 * jsdom's IndexedDB cannot store) are covered too.
 *
 * Host tests in jsdom: they check structure and attributes, not pixels. The
 * actual on-screen size comes from CSS and is checked in a browser.
 */
import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CardBarcode, LoyaltyCard } from '../cards/card.ts'
import { CheckoutScreen } from './CheckoutScreen.tsx'

function makeCard(id: string, storeName: string, barcode: CardBarcode): LoyaltyCard {
  const at = '2026-01-01T00:00:00.000Z'
  return { id, schemaVersion: 2, storeName, color: 'slate', barcode, createdAt: at, updatedAt: at }
}

const image = (detectedFormat?: string): CardBarcode => ({
  kind: 'image',
  image: new Blob(['png'], { type: 'image/png' }),
  ...(detectedFormat ? { detectedFormat, detectedValue: 'X' } : {}),
})

function renderCheckout(cards: LoyaltyCard[], cardId = cards[0]!.id) {
  const onChangeCard = vi.fn()
  const onClose = vi.fn()
  render(<CheckoutScreen cards={cards} cardId={cardId} onChangeCard={onChangeCard} onClose={onClose} />)
  return { onChangeCard, onClose }
}

// jsdom has no object URLs; the saved-image view only needs a string back.
const originalUrl = { create: URL.createObjectURL, revoke: URL.revokeObjectURL }
beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:fake')
  URL.revokeObjectURL = vi.fn()
})

afterEach(() => {
  URL.createObjectURL = originalUrl.create
  URL.revokeObjectURL = originalUrl.revoke
})

describe('CheckoutScreen card-face presentation', () => {
  it.each([
    ['a redrawn QR code', { kind: 'generated', format: 'qrcode', value: 'M-1' }, 'square'],
    ['redrawn Data Matrix', { kind: 'generated', format: 'datamatrix', value: 'M-1' }, 'square'],
    ['redrawn Aztec', { kind: 'generated', format: 'azteccode', value: 'M-1' }, 'square'],
    ['a redrawn PDF417 (wide, never QR)', { kind: 'generated', format: 'pdf417', value: 'M-1' }, 'stacked'],
    ['a redrawn Code 128', { kind: 'generated', format: 'code128', value: '0012' }, 'card'],
    ['a redrawn EAN-13', { kind: 'generated', format: 'ean13', value: '4006381333931' }, 'card'],
    ['imported QR artwork', image('QR code'), 'square'],
    ['imported PDF417 artwork', image('PDF417'), 'stacked'],
    ['an imported Codabar image', image('Codabar'), 'card'],
    ['an imported image with no detected format', image(), 'card'],
    ['a text-only card', { kind: 'text', value: '12345' }, 'card'],
  ] as Array<[string, CardBarcode, string]>)('gives %s the %s face', (_name, barcode, expected) => {
    renderCheckout([makeCard('a', 'Shop', barcode)])
    expect(screen.getByTestId('checkout-card')).toHaveAttribute('data-presentation', expected)
  })

  it('shows imported QR artwork as the saved image (not redrawn) inside the square face', () => {
    renderCheckout([makeCard('a', 'Logo Shop', image('QR code'))])
    const face = screen.getByTestId('checkout-card')
    const img = within(face).getByRole('img', { name: 'Logo Shop barcode (saved image)' })
    expect(img).toHaveAttribute('src', 'blob:fake')
    expect(img).toHaveClass('barcode__image')
  })

  it('updates the face shape when swiping from a linear card to a QR card', () => {
    const cards = [
      makeCard('a', 'Linear', { kind: 'generated', format: 'code128', value: '1' }),
      makeCard('b', 'Square', { kind: 'generated', format: 'qrcode', value: '2' }),
    ]
    const { rerender } = render(<CheckoutScreen cards={cards} cardId="a" onChangeCard={() => {}} onClose={() => {}} />)
    expect(screen.getByTestId('checkout-card')).toHaveAttribute('data-presentation', 'card')
    rerender(<CheckoutScreen cards={cards} cardId="b" onChangeCard={() => {}} onClose={() => {}} />)
    expect(screen.getByTestId('checkout-card')).toHaveAttribute('data-presentation', 'square')
  })
})

describe('CheckoutScreen layout', () => {
  const LONG = 'The Extraordinarily Long Neighbourhood Wholefoods Co-operative Members Rewards Programme'

  it('keeps the complete long name as the dialog label and the caption text', () => {
    renderCheckout([makeCard('a', LONG, { kind: 'generated', format: 'qrcode', value: 'M' })])
    expect(screen.getByRole('dialog', { name: LONG })).toBeInTheDocument()
    const heading = screen.getByRole('heading', { level: 1, name: LONG })
    expect(heading.nextElementSibling).toBe(screen.getByTestId('checkout-card'))
  })

  it('places M8TRX in the top bar, above the name, centred between a spacer and the ×', () => {
    renderCheckout([makeCard('a', 'Shop', { kind: 'generated', format: 'code128', value: '1' })])
    const header = screen.getByTestId('checkout-header')
    const [spacer, brand, close] = Array.from(header.children)
    expect(spacer).toHaveAttribute('aria-hidden', 'true')
    expect(brand).toBe(screen.getByTestId('checkout-brand'))
    expect(close).toBe(screen.getByRole('button', { name: 'Close card' }))
    const heading = screen.getByRole('heading', { level: 1, name: 'Shop' })
    expect(brand!.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('keeps the pagination below the stage and still switches and dismisses by swipe', () => {
    const cards = [
      makeCard('a', 'First', { kind: 'generated', format: 'qrcode', value: '1' }),
      makeCard('b', 'Second', { kind: 'generated', format: 'code128', value: '2' }),
    ]
    const { onChangeCard, onClose } = renderCheckout(cards)
    const stage = screen.getByTestId('checkout-stage')
    expect(stage.nextElementSibling).toBe(screen.getByTestId('checkout-info'))
    expect(within(screen.getByTestId('checkout-info')).getByRole('button', { name: 'Next card' })).toBeEnabled()

    fireEvent.pointerDown(stage, { pointerId: 1, isPrimary: true, clientX: 300, clientY: 200 })
    fireEvent.pointerMove(stage, { pointerId: 1, clientX: 180, clientY: 205 })
    fireEvent.pointerUp(stage, { pointerId: 1, clientX: 180, clientY: 205 })
    expect(onChangeCard).toHaveBeenCalledWith('b')

    fireEvent.pointerDown(stage, { pointerId: 2, isPrimary: true, clientX: 200, clientY: 200 })
    fireEvent.pointerMove(stage, { pointerId: 2, clientX: 205, clientY: 260 })
    fireEvent.pointerMove(stage, { pointerId: 2, clientX: 210, clientY: 360 })
    fireEvent.pointerUp(stage, { pointerId: 2, clientX: 210, clientY: 360 })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
