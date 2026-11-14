/**
 * Checkout mode: one card, presented as a floating tile on a dark stage.
 *
 * Layout (v0.4.1 redesign), top to bottom:
 * - A small top bar holding only the × (close) button.
 * - The stage: the subtle M8TRX backdrop (shared with the wallet, see
 *   app.css) with the card centred on it. The card is a white, card-shaped tile
 *   (credit-card ratio; slightly taller for square 2D codes) with thin bands in the card's accent colour and
 *   the barcode scaled to fit inside it (never stretched: object-fit:
 *   contain, quiet zone inside the image). The card no longer fills the
 *   screen edge to edge.
 * - An information region near the bottom: the store name (the dialog's
 *   label) in the app font and brand colour, directly above the pagination
 *   arrows and dots.
 *
 * Why the redesign: the previous design filled the whole screen (and the
 * iPhone safe areas, via colours published on <html>) with the active card's
 * accent. iOS does not reliably repaint the notch / home-indicator areas on
 * card switches, so the outer surface is now always the dark app background
 * and the accent colour is confined to the card itself (--card-accent set
 * inline on the card face only). Nothing is written to
 * the document root besides the scroll-lock class.
 *
 * - Closing: the ×, Escape, or a deliberate downward swipe on the stage.
 * - Swipe horizontally, use ←/→, or the chevrons to move between cards.
 *   Navigation stops at the first/last card rather than wrapping, so a swipe
 *   never lands on an unexpected card.
 * - Page scrolling, rubber-banding, and pinch-zoom are suppressed while open
 *   (body class + `touch-action: none`); restored on close.
 * - Requests a screen wake lock where supported (useWakeLock).
 * - Card changes are announced through a polite live region.
 *
 * Gesture rules (pointer events on the stage only, so the close and
 * navigation controls stay ordinary buttons):
 * - Dead zone: until the pointer has moved GESTURE_DEAD_ZONE_PX, nothing
 *   moves and no direction is chosen, so taps and finger jitter do nothing.
 * - Axis lock: once past the dead zone the gesture is classified once, as
 *   horizontal or vertical by its dominant axis, and keeps that axis until
 *   release. A horizontal gesture can never close; a vertical one can never
 *   switch cards.
 * - Switch card: a horizontal release beyond SWIPE_DISTANCE_PX, with more
 *   horizontal than vertical travel (unchanged from v0.3.1).
 * - Close: a vertical release at least DISMISS_DISTANCE_PX downward whose
 *   downward travel is at least DISMISS_AXIS_RATIO × the sideways travel
 *   (steeper than ~56°), so diagonal drags don't close. Upward drags never
 *   close. Anything shorter snaps back.
 * - pointercancel (the browser or OS took the gesture) never acts.
 */
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import { BackIcon, ChevronIcon, CloseIcon } from '../../components/icons.tsx'
import { BarcodeView } from '../barcodes/BarcodeView.tsx'
import type { LoyaltyCard } from '../cards/card.ts'
import { tileColor } from '../cards/tileColors.ts'
import { gestureAction, GESTURE_DEAD_ZONE_PX, type Axis } from './gesture.ts'
import { useWakeLock } from './useWakeLock.ts'

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
  const drag = useRef<{ id: number; x: number; y: number; axis?: Axis } | null>(null)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  // Announce only after the user switches cards, not when checkout opens
  // (the dialog's label already names the card then).
  const [switched, setSwitched] = useState(false)
  const changeCard = (id: string) => {
    setSwitched(true)
    onChangeCard(id)
  }

  useWakeLock(true)

  // Lock page scrolling while open; restore on close. Focus the × once, on
  // open only: switching cards must not move focus.
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
    const current = drag.current
    if (!current || current.id !== event.pointerId) return
    const dx = (event.clientX ?? 0) - current.x
    const dy = (event.clientY ?? 0) - current.y
    if (!current.axis) {
      if (Math.hypot(dx, dy) < GESTURE_DEAD_ZONE_PX) return
      current.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
    }
    if (current.axis === 'x') {
      // Resist dragging past the ends so it's clear there is no further card.
      const atEnd = (dx > 0 && !previous) || (dx < 0 && !next)
      setOffset({ x: atEnd ? dx / 4 : dx, y: 0 })
    } else {
      // Follow downward drags (damped) as a preview of closing; resist upward.
      setOffset({ x: 0, y: dy > 0 ? dy * 0.6 : dy / 6 })
    }
  }

  const endDrag = (event: PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const current = drag.current
    if (!current || current.id !== event.pointerId) return
    const dx = (event.clientX ?? 0) - current.x
    const dy = (event.clientY ?? 0) - current.y
    drag.current = null
    setOffset({ x: 0, y: 0 })
    if (cancelled) return
    const action = gestureAction(dx, dy, current.axis)
    if (action === 'close') onClose()
    else if (action === 'next' && next) changeCard(next.id)
    else if (action === 'previous' && previous) changeCard(previous.id)
  }

  // The accent is scoped to the card face (its bands) so the stage stays dark.
  // No text sits on the accent any more, so its paired text colour is unused.
  const accent = { '--card-accent': tileColor(card.color).background } as CSSProperties
  const settled = offset.x === 0 && offset.y === 0

  return (
    <div className="checkout" role="dialog" aria-modal="true" aria-labelledby="checkout-store">
      <div className="checkout__top" data-testid="checkout-header">
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
        {/* Outer element carries the drag offset; the face inside is the visible card. */}
        <div
          key={card.id}
          className={settled ? 'checkout__card checkout__card--settled' : 'checkout__card'}
          style={settled ? undefined : { transform: `translate(${offset.x}px, ${offset.y}px)` }}
        >
          <div className="checkout__face" data-testid="checkout-card" style={accent}>
            <span className="checkout__band" aria-hidden="true" />
            <div className="checkout__code">
              <BarcodeView barcode={card.barcode} label={`${card.storeName} barcode`} />
            </div>
            <span className="checkout__band checkout__band--bottom" aria-hidden="true" />
          </div>
        </div>
      </div>

      {/* Bottom information region: store name directly above the pagination. */}
      <div className="checkout__info" data-testid="checkout-info">
        <h1 id="checkout-store" className="checkout__store">
          {card.storeName}
        </h1>
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
      </div>

      <p className="visually-hidden" role="status" aria-live="polite">
        {switched ? `${card.storeName}, card ${index + 1} of ${cards.length}` : ''}
      </p>
    </div>
  )
}
