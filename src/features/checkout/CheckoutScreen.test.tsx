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

function makeCard(id: string, storeName: string, barcode: CardBarcode, extra: Partial<LoyaltyCard> = {}): LoyaltyCard {
  const at = '2026-01-01T00:00:00.000Z'
  return { id, schemaVersion: 2, storeName, color: 'slate', barcode, createdAt: at, updatedAt: at, ...extra }
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
    renderCheckout([makeCard('a', 'Shop', barcode, { icon: 'retail' })])
    const face = screen.getByTestId('checkout-card')
    expect(face).toHaveAttribute('data-presentation', expected)
    // v0.6.1: the code still renders, alone, in the white code area between
    // the bands, unaffected by the title and icon moving into the upper band.
    const code = within(face).getByTestId('checkout-code')
    const rendered = code.querySelector('.barcode')
    expect(rendered).not.toBeNull()
    expect(code.children).toHaveLength(1)
    expect(within(code).queryByRole('heading')).not.toBeInTheDocument()
    expect(code.querySelector('svg[data-icon]')).toBeNull()
    const [top, middle, bottom] = Array.from(face.children)
    expect(top).toBe(within(face).getByTestId('checkout-band'))
    expect(middle).toBe(code)
    expect(bottom).toHaveClass('checkout__band', 'checkout__band--bottom')
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

  it('keeps the complete long name as the dialog label and the band title text', () => {
    renderCheckout([makeCard('a', LONG, { kind: 'generated', format: 'qrcode', value: 'M' })])
    expect(screen.getByRole('dialog', { name: LONG })).toBeInTheDocument()
    const heading = screen.getByRole('heading', { level: 1, name: LONG })
    expect(heading).toHaveTextContent(LONG)
    expect(screen.getByTestId('checkout-band')).toContainElement(heading)
  })

  it('puts the category icon to the left of the title inside the upper colored band', () => {
    renderCheckout([makeCard('a', 'Morning Brew', { kind: 'generated', format: 'qrcode', value: 'M' }, { icon: 'coffee' })])
    const face = screen.getByTestId('checkout-card')
    const band = within(face).getByTestId('checkout-band')
    expect(band.parentElement).toBe(face)
    const [iconSlot, title] = Array.from(band.children)
    expect(iconSlot!.querySelector('svg[data-icon="coffee"]')).toHaveAttribute('aria-hidden', 'true')
    expect(title).toBe(screen.getByRole('heading', { level: 1, name: 'Morning Brew' }))
  })

  it('shows only the title in the band when no icon is chosen', () => {
    renderCheckout([makeCard('a', 'Plain', { kind: 'generated', format: 'code128', value: '1' })])
    const band = screen.getByTestId('checkout-band')
    expect(band.querySelector('svg[data-icon]')).toBeNull()
    expect(Array.from(band.children)).toEqual([screen.getByRole('heading', { level: 1, name: 'Plain' })])
  })

  it.each([
    ['Ivory: Charcoal', 'white', '#E5E0D1', '#1A1A1A'],
    ['Copper: Soft Silver', 'orange', '#A26443', '#E8ECEB'],
    ['Brushed Steel: Soft Silver', 'teal', '#727F89', '#E8ECEB'],
    ['Antique Gold: Soft Silver', 'yellow', '#9B7B20', '#E8ECEB'],
    ['Midnight Blue: Soft Silver', 'indigo', '#244669', '#E8ECEB'],
  ])('uses the tile’s title/icon color on %s', (_name, color, background, text) => {
    renderCheckout([makeCard('a', 'Shop', { kind: 'generated', format: 'code128', value: '1' }, { color, icon: 'events' })])
    const face = screen.getByTestId('checkout-card')
    expect(face.style.getPropertyValue('--card-accent')).toBe(background)
    expect(face.style.getPropertyValue('--card-on-accent')).toBe(text)
    const strokes = within(face).getByTestId('checkout-band').querySelector('svg[data-icon="events"] g')
    expect(strokes).toHaveAttribute('stroke', 'currentColor')
    expect(face.querySelector('[data-part="halo"]')).toBeNull()
  })

  it('places the shared M8TRX header (logo then title) upper left, with the × on the right, above the name', () => {
    renderCheckout([makeCard('a', 'Shop', { kind: 'generated', format: 'code128', value: '1' })])
    const header = screen.getByTestId('app-header')
    expect(header).toHaveClass('app-header', 'checkout__top')
    // Not a banner landmark inside the modal dialog.
    expect(header.tagName).toBe('DIV')
    const [brand, close] = Array.from(header.children)
    expect(brand).toBe(screen.getByTestId('brand-lockup'))
    expect(brand).toHaveAttribute('aria-hidden', 'true')
    const [logo, title] = Array.from(brand!.children)
    expect(logo).toBe(screen.getByTestId('brand-logo'))
    expect(logo).toHaveAttribute('alt', '')
    expect(title).toHaveTextContent('M8TRX')
    expect(title).toHaveClass('brand-lockup__title')
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
