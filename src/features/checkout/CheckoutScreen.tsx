/**
 * Checkout mode: one card, presented as a floating tile on a dark stage.
 *
 * Layout (v0.5.0), top to bottom:
 * - Top bar: the shared M8TRX header (components/AppHeader.tsx): DIM8 logo
 *   and M8TRX in the upper-left corner, exactly as on the wallet, with the
 *   × (close) button on the right. The lockup is decorative branding
 *   (aria-hidden); the dialog is still labelled by the card name. Iteration
 *   4F replaced the larger, centred v0.4.2 title; on notched iPhones the top
 *   bar keeps its previous height, so the stage and card do not move.
 * - The stage: the subtle M8TRX backdrop (shared with the wallet, see
 *   app.css) with the card group centred on it. The group is the store name
 *   (the dialog's label, in the app font and DIM8 brand colour) immediately
 *   above the card. The card is a white tile whose shape follows the barcode
 *   (see barcodes/presentation.ts): a compact credit-card face for linear
 *   codes and unknown images, a near-square face for QR / Data Matrix /
 *   Aztec (redrawn or saved artwork), and the slightly taller v0.4.1 face for
 *   PDF417. Thin bands in the card's accent colour; the barcode is scaled to
 *   fit (never stretched: object-fit: contain, quiet zone inside the image).
 * - Bottom: the pagination arrows and dots (unchanged position).
 *
 * v0.4.2 moved the store name from above the pagination to directly above
 * the card, so the name reads as the card's caption.
 *
 * Why the dark stage (v0.4.1): the earlier design filled the whole screen (and the
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
import { AppHeader } from '../../components/AppHeader.tsx'
import { BackIcon, ChevronIcon, CloseIcon } from '../../components/icons.tsx'
import { BarcodeView } from '../barcodes/BarcodeView.tsx'
import { checkoutPresentation } from '../barcodes/presentation.ts'
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
      <AppHeader
        className="checkout__top"
        decorative
        action={
          <button ref={closeRef} type="button" className="checkout__close" aria-label="Close card" onClick={onClose}>
            <CloseIcon />
          </button>
        }
      />

      <div
        className="checkout__stage"
        data-testid="checkout-stage"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(event) => endDrag(event, false)}
        onPointerCancel={(event) => endDrag(event, true)}
      >
        {/* The name and the card move together while dragging, so the caption stays attached. */}
        <div
          key={card.id}
          className={settled ? 'checkout__card checkout__card--settled' : 'checkout__card'}
          style={settled ? undefined : { transform: `translate(${offset.x}px, ${offset.y}px)` }}
        >
          <h1 id="checkout-store" className="checkout__store">
            {card.storeName}
          </h1>
          <div
            className="checkout__face"
            data-testid="checkout-card"
            data-presentation={checkoutPresentation(card.barcode)}
            style={accent}
          >
            <span className="checkout__band" aria-hidden="true" />
            <div className="checkout__code">
              <BarcodeView barcode={card.barcode} label={`${card.storeName} barcode`} />
            </div>
            <span className="checkout__band checkout__band--bottom" aria-hidden="true" />
          </div>
        </div>
      </div>

      {/* Bottom region: pagination only (the name now sits above the card). */}
      <div className="checkout__info" data-testid="checkout-info">
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
