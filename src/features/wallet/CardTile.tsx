/**
 * One square wallet tile: a miniature card preview (CardPreview) and the store
 * name on the card's colour.
 *
 * Interaction:
 * - Tap / click / Enter / Space on the tile opens the card at checkout.
 * - Long-press (touch) or right-click opens the management menu.
 * - A small "⋯" button in the corner opens the same menu. It is the
 *   accessible, discoverable alternative to long-press for keyboard, switch,
 *   and screen-reader users, and for anyone who doesn't know about long-press.
 *
 * Deliberately shows nothing else: no number, dates, or notes. The preview is
 * decorative (aria-hidden) and never encodes the card's value, so the tile's
 * accessible name remains just the store name.
 */
import { useEffect, useRef, type CSSProperties } from 'react'
import { MoreIcon } from '../../components/icons.tsx'
import type { LoyaltyCard } from '../cards/card.ts'
import { tileColor } from '../cards/tileColors.ts'
import { CardPreview } from './CardPreview.tsx'
import { useLongPress } from './useLongPress.ts'

export interface CardTileProps {
  card: LoyaltyCard
  onOpen: (cardId: string) => void
  onOpenMenu: (cardId: string) => void
  /** Take focus on mount, e.g. when returning from checkout to this card. */
  autoFocus?: boolean
}

export function CardTile({ card, onOpen, onOpenMenu, autoFocus = false }: CardTileProps) {
  const tileRef = useRef<HTMLButtonElement>(null)
  const colors = tileColor(card.color)
  const longPress = useLongPress(() => {
    // Touch long-press doesn't focus the button; focus it so the menu can
    // return focus here when it closes.
    tileRef.current?.focus({ preventScroll: true })
    onOpenMenu(card.id)
  })

  useEffect(() => {
    if (autoFocus) tileRef.current?.focus({ preventScroll: false })
  }, [autoFocus])

  return (
    <li className="tile" style={{ background: colors.background, color: colors.text, '--tile-accent': colors.background } as CSSProperties}>
      <button
        ref={tileRef}
        type="button"
        className="tile__open"
        onClick={() => onOpen(card.id)}
        {...longPress}
      >
        <CardPreview card={card} />
        <span className="tile__name">{card.storeName}</span>
      </button>
      <button
        type="button"
        className="tile__more"
        aria-label={`Options for ${card.storeName}`}
        onClick={() => onOpenMenu(card.id)}
      >
        <MoreIcon />
      </button>
    </li>
  )
}
