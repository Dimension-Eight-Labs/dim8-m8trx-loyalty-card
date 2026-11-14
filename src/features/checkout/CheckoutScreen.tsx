/**
 * Checkout mode: one card, full screen, barcode as large as practical.
 *
 * - Presented as a clean digital card: a narrow header band in the card's
 *   accent colour carrying the store name (large, bold) and a small × in the
 *   upper-right, a matching narrow band at the bottom, and a white stage
 *   between them. Band colours and text colours come from the tile palette
 *   (tileColors.ts), whose pairs all meet WCAG 4.5:1.
 * - The stage stays white for maximum contrast (and the most light from the
 *   screen); the barcode image carries its own quiet zone on top of that, and
 *   is never stretched (object-fit: contain, centred).
 * - Closing: the ×, Escape, or a deliberate downward swipe on the stage.
 * - Swipe horizontally, use ←/→, or the small chevrons to move between cards.
 *   Navigation stops at the first/last card rather than wrapping, so a swipe
 *   never lands on an unexpected card.
 * - Page scrolling, rubber-banding, and pinch-zoom are suppressed while open
 *   (body class + `touch-action: none`); restored on close.
 * - Safe-area colour (v0.4.0 fix): while open, the active card's accent and
 *   text colours are also published on <html> as --checkout-accent /
 *   --checkout-on-accent, and the document canvas (html/body) is painted
 *   with them. On iPhone the area around the notch / Dynamic Island and the
 *   home indicator can be painted from the document canvas rather than from
 *   the fixed checkout bands, so painting only the bands left that area in
 *   the colour of the wallet or of the first card shown. The root properties
 *   are rewritten before paint whenever the active card changes and removed
 *   on close, so header, notch area and bottom strip always share one value.
 * - Requests a screen wake lock where supported (useWakeLock).
 * - Card changes are announced through a polite live region.
 *
 * Gesture rules (pointer events on the stage only, so header and navigation
 * controls stay ordinary buttons):
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
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import { BackIcon, ChevronIcon, CloseIcon } from '../../components/icons.tsx'
import { BarcodeView } from '../barcodes/BarcodeView.tsx'
import type { LoyaltyCard } from '../cards/card.ts'
import { tileColor } from '../cards/tileColors.ts'
import { gestureAction, GESTURE_DEAD_ZONE_PX, type Axis } from './gesture.ts'
import { useWakeLock } from './useWakeLock.ts'

/** Root (<html>) custom properties owned by checkout while it is open; read by app.css. */
export const ROOT_ACCENT = '--checkout-accent'
export const ROOT_ON_ACCENT = '--checkout-on-accent'

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

  // Publish the ACTIVE card's colours on <html> (see the header comment).
  // Layout effect so the root updates in the same frame as the header: a
  // passive effect could paint one frame with the previous card's colour.
  // Keyed on the colour values, so it re-runs on every card switch rather
  // than capturing the colour of the card checkout opened with.
  const colors = card ? tileColor(card.color) : null
  const accentColor = colors?.background
  const onAccentColor = colors?.text
  useLayoutEffect(() => {
    if (!accentColor || !onAccentColor) return
    const root = document.documentElement.style
    root.setProperty(ROOT_ACCENT, accentColor)
    root.setProperty(ROOT_ON_ACCENT, onAccentColor)
  }, [accentColor, onAccentColor])

  // Remove the root colours only when checkout closes, not between cards,
  // so there is never a frame where the canvas falls back to the wallet colour.
  useLayoutEffect(
    () => () => {
      const root = document.documentElement.style
      root.removeProperty(ROOT_ACCENT)
      root.removeProperty(ROOT_ON_ACCENT)
    },
    [],
  )

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

  const accent = { '--card-accent': accentColor, '--card-on-accent': onAccentColor } as CSSProperties
  const settled = offset.x === 0 && offset.y === 0

  return (
    <div className="checkout" role="dialog" aria-modal="true" aria-labelledby="checkout-store" style={accent}>
      <div className="checkout__top" data-testid="checkout-header">
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
          className={settled ? 'checkout__card checkout__card--settled' : 'checkout__card'}
          style={settled ? undefined : { transform: `translate(${offset.x}px, ${offset.y}px)` }}
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

      <div className="checkout__bottom" data-testid="checkout-footer" aria-hidden="true" />

      <p className="visually-hidden" role="status" aria-live="polite">
        {switched ? `${card.storeName}, card ${index + 1} of ${cards.length}` : ''}
      </p>
    </div>
  )
}
