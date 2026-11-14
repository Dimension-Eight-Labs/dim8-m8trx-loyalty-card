/**
 * Home screen: the wallet of card tiles.
 *
 * Layout: a responsive grid of square tiles (two columns on phones, more on
 * wider screens; see .wallet-grid in app.css). The Add Card button lives in
 * the app header's corner (see App). The heading is visually hidden: the
 * tiles speak for themselves, but screen-reader users still get a landmark
 * label and a focus target after navigation.
 *
 * Ordering (v0.4.0): tiles appear in the user's saved order. Press-and-hold
 * (touch) or drag (mouse/pen) rearranges them; see useWalletReorder. When the
 * displayed order changes (during a drag, after a keyboard move, or when a
 * failed save reverts) tiles glide from their old slot to the new one using
 * FLIP: measure layout before and after, then animate the difference as a
 * transform, so the grid itself never changes shape. Skipped under
 * prefers-reduced-motion.
 *
 * Presentation only; the parent owns data, persistence, navigation, and the
 * dialogs.
 */
import { useLayoutEffect, useRef, type RefObject } from 'react'
import { ViewHeading } from '../../components/ViewHeading.tsx'
import type { LoyaltyCard } from '../cards/card.ts'
import { CardTile } from './CardTile.tsx'
import { prefersReducedMotion, useWalletReorder } from './useWalletReorder.ts'

/** Duration of the slide when tiles change places. Short, so it reads as feedback, not decoration. */
const REORDER_ANIMATION_MS = 180

export interface WalletScreenProps {
  cards: LoyaltyCard[]
  focusOnMount?: boolean
  onOpenCard: (cardId: string) => void
  onOpenMenu: (cardId: string) => void
  /** Persists a new order after a drag; settles once saved or failed. */
  onReorder?: (orderedIds: string[]) => Promise<unknown>
  /** Tile to focus on mount (the card just closed or just added). */
  focusCardId?: string
  /** Re-focus request for one tile (e.g. after a keyboard move); `seq` changes per request. */
  focusRequest?: { cardId: string; seq: number }
}

export function WalletScreen({ cards, focusOnMount = false, onOpenCard, onOpenMenu, onReorder, focusCardId, focusRequest }: WalletScreenProps) {
  const gridRef = useRef<HTMLUListElement>(null)
  const { orderedCards, draggingId, handlersFor } = useWalletReorder({ cards, gridRef, onReorder })
  useFlipAnimation(gridRef, orderedCards, draggingId)

  return (
    <section className="wallet" aria-labelledby="wallet-heading">
      <ViewHeading id="wallet-heading" className="visually-hidden" focusOnMount={focusOnMount}>
        Your cards
      </ViewHeading>
      <ul ref={gridRef} className={draggingId ? 'wallet-grid wallet-grid--dragging' : 'wallet-grid'}>
        {orderedCards.map((card) => (
          <CardTile
            key={card.id}
            card={card}
            onOpen={onOpenCard}
            onOpenMenu={onOpenMenu}
            dragHandlers={handlersFor(card.id)}
            dragging={card.id === draggingId}
            autoFocus={card.id === focusCardId}
            focusToken={focusRequest?.cardId === card.id ? focusRequest.seq : undefined}
          />
        ))}
      </ul>
    </section>
  )
}

/**
 * Slides tiles whose grid slot changed since the last render. Positions come
 * from offsetLeft/offsetTop (layout, unaffected by transforms). The dragged
 * tile is skipped: it follows the pointer instead.
 */
function useFlipAnimation(gridRef: RefObject<HTMLUListElement | null>, cards: LoyaltyCard[], draggingId: string | null) {
  const positions = useRef(new Map<string, { x: number; y: number }>())
  const orderKey = cards.map((card) => card.id).join('\u0000')
  const lastKey = useRef(orderKey)

  useLayoutEffect(() => {
    const grid = gridRef.current
    if (!grid) return
    const animate = orderKey !== lastKey.current && !prefersReducedMotion()
    lastKey.current = orderKey
    const next = new Map<string, { x: number; y: number }>()
    for (const child of Array.from(grid.children)) {
      if (!(child instanceof HTMLElement) || !child.dataset.cardId) continue
      const id = child.dataset.cardId
      const position = { x: child.offsetLeft, y: child.offsetTop }
      next.set(id, position)
      const previous = positions.current.get(id)
      if (!animate || !previous || id === draggingId || typeof child.animate !== 'function') continue
      const dx = previous.x - position.x
      const dy = previous.y - position.y
      if (dx === 0 && dy === 0) continue
      child.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], {
        duration: REORDER_ANIMATION_MS,
        easing: 'cubic-bezier(0.2, 0, 0, 1)',
      })
    }
    positions.current = next
  })
}
