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
  /** All readable cards in wallet order (oldest first). */
  list(): Promise<LoyaltyCard[]>
  /** Validates and stores a new card. The store name is trimmed; barcode data never is. */
  create(input: NewCardInput): Promise<LoyaltyCard>
  /** Renames and/or recolours a card and bumps `updatedAt`. */
  update(id: string, changes: CardChanges): Promise<LoyaltyCard>
  /** Removes a card. Rejects if it does not exist. */
  delete(id: string): Promise<void>
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
