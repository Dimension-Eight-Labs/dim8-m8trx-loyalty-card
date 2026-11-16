/**
 * One wallet tile (redesigned in v0.6.0; shortened to a 3:2 rectangle in
 * v0.6.1): the card's color, an optional category icon in the upper-left
 * corner, and the card name on a single line in a fixed lower band. The icon
 * and name share the palette's text color (Soft Silver on the dark colors, Charcoal
 * on Ivory; see tileColors.ts), set once on the <li>.
 *
 * Layout invariants (see `.tile` in app.css): the icon slot and the name band
 * have fixed positions and sizes whether or not an icon is set, and the name
 * never wraps (long names end in an ellipsis), so every tile has identical
 * dimensions and every name sits in the same place. The barcode-type preview
 * shown before v0.6.0 is gone; no universal decorative symbol replaces it.
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
 * Deliberately shows nothing else: no number, dates, or notes. The icon is
 * decorative (aria-hidden). The tile button's accessible name is set
 * explicitly to the full, untruncated store name, so visual truncation never
 * shortens what assistive technology announces; checkout shows the full name.
 */
import { useEffect, useRef } from 'react'
import { MoreIcon } from '../../components/icons.tsx'
import type { LoyaltyCard } from '../cards/card.ts'
import { CardCategoryIcon } from '../cards/CardCategoryIcon.tsx'
import { tileColor } from '../cards/tileColors.ts'
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
      style={{ background: colors.background, color: colors.text }}
    >
      <button
        ref={tileRef}
        type="button"
        className="tile__open"
        aria-label={card.storeName}
        onClick={() => onOpen(card.id)}
        {...dragHandlers}
      >
        {/* The slot is always rendered so tiles with and without an icon match. */}
        <span className="tile__icon" data-testid="tile-icon-slot">
          {card.icon && <CardCategoryIcon icon={card.icon} />}
        </span>
        <span className="tile__name" title={card.storeName}>
          {card.storeName}
        </span>
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
