/**
 * Checkout mode: one card, full screen, barcode as large as practical.
 *
 * - White background for maximum contrast (and the most light from the
 *   screen); the barcode image carries its own quiet zone on top of that.
 * - Store name small and grey at the top; a small × closes (also Escape).
 * - Swipe horizontally, use ←/→, or the small chevrons to move between cards.
 *   Navigation stops at the first/last card rather than wrapping, so a swipe
 *   never lands on an unexpected card.
 * - Page scrolling, rubber-banding, and pinch-zoom are suppressed while open
 *   (body class + `touch-action: none`); restored on close.
 * - Requests a screen wake lock where supported (useWakeLock).
 * - Card changes are announced through a polite live region.
 *
 * Swipe thresholds: a release beyond SWIPE_DISTANCE_PX horizontally, with
 * more horizontal than vertical travel, changes card. Shorter or vertical
 * drags snap back, so taps and small jitters never switch cards.
 */
import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { BackIcon, ChevronIcon, CloseIcon } from '../../components/icons.tsx'
import { BarcodeView } from '../barcodes/BarcodeView.tsx'
import type { LoyaltyCard } from '../cards/card.ts'
import { useWakeLock } from './useWakeLock.ts'

export const SWIPE_DISTANCE_PX = 60

export interface CheckoutScreenProps {
  cards: LoyaltyCard[]
  cardId: string
  onChangeCard: (cardId: string) => void
  onClose: () => void
}

export function CheckoutScreen({ cards, cardId, onChangeCard, onClose }: CheckoutScreenProps) {
  const index = Math.max(0, cards.findIndex((card) => card.id === cardId))
  const card = cards[index]
  const previous = cards[index - 1]
  const next = cards[index + 1]
  const closeRef = useRef<HTMLButtonElement>(null)
  const drag = useRef<{ id: number; x: number; y: number } | null>(null)
  const [offset, setOffset] = useState(0)
  // Announce only after the user switches cards, not when checkout opens
  // (the dialog's label already names the card then).
  const [switched, setSwitched] = useState(false)
  const changeCard = (id: string) => {
    setSwitched(true)
    onChangeCard(id)
  }

  useWakeLock(true)

  // Lock page scrolling while open; restore on close.
  useEffect(() => {
    document.documentElement.classList.add('checkout-open')
    closeRef.current?.focus({ preventScroll: true })
    return () => document.documentElement.classList.remove('checkout-open')
  }, [])

  // Keyboard: arrows switch, Escape closes. Window-level so it works wherever focus is.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      } else if (event.key === 'ArrowLeft' && previous) {
        event.preventDefault()
        setSwitched(true)
        onChangeCard(previous.id)
      } else if (event.key === 'ArrowRight' && next) {
        event.preventDefault()
        setSwitched(true)
        onChangeCard(next.id)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [previous, next, onChangeCard, onClose])

  if (!card) return null

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary) return
    drag.current = { id: event.pointerId, x: event.clientX ?? 0, y: event.clientY ?? 0 }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current || drag.current.id !== event.pointerId) return
    const dx = (event.clientX ?? 0) - drag.current.x
    // Resist dragging past the ends so it's clear there is no further card.
    const atEnd = (dx > 0 && !previous) || (dx < 0 && !next)
    setOffset(atEnd ? dx / 4 : dx)
  }

  const endDrag = (event: PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    if (!drag.current || drag.current.id !== event.pointerId) return
    const dx = (event.clientX ?? 0) - drag.current.x
    const dy = (event.clientY ?? 0) - drag.current.y
    drag.current = null
    setOffset(0)
    if (cancelled || Math.abs(dx) < SWIPE_DISTANCE_PX || Math.abs(dx) <= Math.abs(dy)) return
    if (dx < 0 && next) changeCard(next.id)
    if (dx > 0 && previous) changeCard(previous.id)
  }

  return (
    <div className="checkout" role="dialog" aria-modal="true" aria-labelledby="checkout-store">
      <div className="checkout__top">
        <h1 id="checkout-store" className="checkout__store">
          {card.storeName}
        </h1>
        <button ref={closeRef} type="button" className="checkout__close" aria-label="Close card" onClick={onClose}>
          <CloseIcon />
        </button>
      </div>

      <div
        className="checkout__stage"
        data-testid="checkout-stage"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(event) => endDrag(event, false)}
        onPointerCancel={(event) => endDrag(event, true)}
      >
        <div
          key={card.id}
          className={offset === 0 ? 'checkout__card checkout__card--settled' : 'checkout__card'}
          style={offset === 0 ? undefined : { transform: `translateX(${offset}px)` }}
        >
          <BarcodeView barcode={card.barcode} label={`${card.storeName} barcode`} />
        </div>
      </div>

      {cards.length > 1 && (
        <div className="checkout__nav">
          <button
            type="button"
            className="checkout__step"
            aria-label="Previous card"
            disabled={!previous}
            onClick={() => previous && changeCard(previous.id)}
          >
            <BackIcon />
          </button>
          <p className="checkout__dots" aria-hidden="true">
            {cards.map((item) => (
              <span key={item.id} className={item.id === card.id ? 'checkout__dot checkout__dot--active' : 'checkout__dot'} />
            ))}
          </p>
          <button
            type="button"
            className="checkout__step"
            aria-label="Next card"
            disabled={!next}
            onClick={() => next && changeCard(next.id)}
          >
            <ChevronIcon />
          </button>
        </div>
      )}

      <p className="visually-hidden" role="status" aria-live="polite">
        {switched ? `${card.storeName}, card ${index + 1} of ${cards.length}` : ''}
      </p>
    </div>
  )
}
