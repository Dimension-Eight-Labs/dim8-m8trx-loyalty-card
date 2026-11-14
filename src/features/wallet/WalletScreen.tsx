/**
 * Home screen: the wallet of card tiles.
 *
 * Layout: a responsive grid of square tiles (two columns on phones, more on
 * wider screens; see .wallet-grid in app.css). The Add Card button lives in
 * the app header's corner (see App). The heading is visually hidden: the
 * tiles speak for themselves, but screen-reader users still get a landmark
 * label and a focus target after navigation.
 *
 * Presentation only; the parent owns data, navigation, and the dialogs.
 */
import { ViewHeading } from '../../components/ViewHeading.tsx'
import type { LoyaltyCard } from '../cards/card.ts'
import { CardTile } from './CardTile.tsx'

export interface WalletScreenProps {
  cards: LoyaltyCard[]
  focusOnMount?: boolean
  onOpenCard: (cardId: string) => void
  onOpenMenu: (cardId: string) => void
  /** Tile to focus on mount (the card just closed or just added). */
  focusCardId?: string
}

export function WalletScreen({ cards, focusOnMount = false, onOpenCard, onOpenMenu, focusCardId }: WalletScreenProps) {
  return (
    <section className="wallet" aria-labelledby="wallet-heading">
      <ViewHeading id="wallet-heading" className="visually-hidden" focusOnMount={focusOnMount}>
        Your cards
      </ViewHeading>
      <ul className="wallet-grid">
        {cards.map((card) => (
          <CardTile
            key={card.id}
            card={card}
            onOpen={onOpenCard}
            onOpenMenu={onOpenMenu}
            autoFocus={card.id === focusCardId}
          />
        ))}
      </ul>
    </section>
  )
}
