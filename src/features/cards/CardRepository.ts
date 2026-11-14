/**
 * Storage contract for loyalty cards.
 *
 * The UI depends only on this interface; the IndexedDB adapter
 * (src/data/indexedDbCardRepository.ts) is chosen in src/main.tsx. Tests can
 * inject an in-memory or deliberately failing implementation.
 *
 * Every method is asynchronous and rejects with an Error whose message is safe
 * to show to the user. A mutation resolves only once the change is durable.
 */
import type { CardChanges, LoyaltyCard, NewCardInput } from './card.ts'

export interface CardRepository {
  /** All readable cards in the user's wallet order. New cards are last. */
  list(): Promise<LoyaltyCard[]>
  /** Validates and stores a new card at the end of the wallet order. The store name is trimmed; barcode data never is. */
  create(input: NewCardInput): Promise<LoyaltyCard>
  /** Renames and/or recolours a card and bumps `updatedAt`. Never changes its position. */
  update(id: string, changes: CardChanges): Promise<LoyaltyCard>
  /** Removes a card (and its place in the wallet order). Rejects if it does not exist. */
  delete(id: string): Promise<void>
  /**
   * Saves a new wallet order. `orderedIds` must name every card that `list()`
   * returns exactly once and nothing else; otherwise it rejects with a
   * CardValidationError and nothing is saved (e.g. another tab added or
   * deleted a card meanwhile). Atomic: either the whole new order is stored
   * or the previous one remains. Card records themselves are not rewritten.
   */
  reorder(orderedIds: readonly string[]): Promise<void>
  /**
   * Adds already-complete cards (from a validated backup) after the existing
   * cards, in the given order, keeping their IDs, timestamps and barcode data
   * exactly. All-or-nothing: if any card is invalid, any ID is already in
   * use, storage fails, or the wallet no longer matches `expectedOrder` (the
   * card IDs, in wallet order, that the caller planned against), it rejects
   * and nothing is stored. Existing cards are never modified or removed.
   */
  importCards(cards: readonly LoyaltyCard[], expectedOrder: readonly string[]): Promise<void>
}

/** Rejection used when input fails domain validation. */
export class CardValidationError extends Error {
  constructor(message = 'Some card details are missing or invalid.') {
    super(message)
    this.name = 'CardValidationError'
  }
}

/** Rejection used when the target card no longer exists. */
export class CardNotFoundError extends Error {
  constructor(message = 'That card no longer exists.') {
    super(message)
    this.name = 'CardNotFoundError'
  }
}
