/**
 * One square wallet tile: a miniature card preview (CardPreview) and the store
 * name on the card's colour.
 *
 * Interaction:
 * - Tap / click / Enter / Space on the tile opens the card at checkout.
 * - Press-and-hold (touch) or drag (mouse/pen) on the tile rearranges the
 *   wallet; the handlers come from useWalletReorder via `dragHandlers`.
 *   Long-press no longer opens the management menu (v0.4.0).
 * - A small "⋯" button in the corner opens the management menu (rename,
 *   colour, keyboard move actions, delete). It is the only entry point to
 *   that menu and never starts a drag.
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
import type { TileDragHandlers } from './useWalletReorder.ts'

export interface CardTileProps {
  card: LoyaltyCard
  onOpen: (cardId: string) => void
  onOpenMenu: (cardId: string) => void
  /** Reorder gesture handlers for the tile's main button. */
  dragHandlers?: TileDragHandlers
  /** True while this tile is being dragged (lift styling). */
  dragging?: boolean
  /** Take focus on mount, e.g. when returning from checkout to this card. */
  autoFocus?: boolean
  /** Changes to a new number to request focus again (e.g. after a keyboard move). */
  focusToken?: number
}

export function CardTile({ card, onOpen, onOpenMenu, dragHandlers, dragging = false, autoFocus = false, focusToken }: CardTileProps) {
  const tileRef = useRef<HTMLButtonElement>(null)
  const colors = tileColor(card.color)

  useEffect(() => {
    if (autoFocus) tileRef.current?.focus({ preventScroll: false })
  }, [autoFocus])

  useEffect(() => {
    if (focusToken !== undefined) tileRef.current?.focus({ preventScroll: false })
  }, [focusToken])

  return (
    <li
      className={dragging ? 'tile tile--dragging' : 'tile'}
      data-card-id={card.id}
      style={{ background: colors.background, color: colors.text, '--tile-accent': colors.background } as CSSProperties}
    >
      <button ref={tileRef} type="button" className="tile__open" onClick={() => onOpen(card.id)} {...dragHandlers}>
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
