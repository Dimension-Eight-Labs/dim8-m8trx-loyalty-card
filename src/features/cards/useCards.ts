/**
 * Card controller hook: loads cards from a CardRepository and exposes
 * mutations that keep the in-memory list in sync with storage.
 *
 * - `status` starts as 'loading', so the UI can avoid flashing the empty state
 *   before IndexedDB has answered.
 * - A failed load moves to 'error' with a message; `reload()` retries.
 * - Mutations never throw. They resolve to a result object so forms can keep
 *   their entered values and show the message. The list is updated only after
 *   the repository confirms the change (no optimistic updates), so the screen
 *   never shows data that was not actually saved.
 * - `cards` is in the user's wallet order (from the repository). New cards
 *   are appended; rename/recolour keep their position; `reorderCards` saves
 *   a whole new order and applies it only once storage confirms it, so a
 *   failed save leaves the previous order on screen.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CardChanges, LoyaltyCard, NewCardInput } from './card.ts'
import { CardNotFoundError, type CardRepository } from './CardRepository.ts'

export type CardsStatus = 'loading' | 'ready' | 'error'

export type MutationResult<T> = { ok: true; value: T } | { ok: false; message: string }

export interface UseCardsResult {
  status: CardsStatus
  cards: LoyaltyCard[]
  loadError: string | null
  reload: () => void
  createCard: (input: NewCardInput) => Promise<MutationResult<LoyaltyCard>>
  updateCard: (id: string, changes: CardChanges) => Promise<MutationResult<LoyaltyCard>>
  deleteCard: (id: string) => Promise<MutationResult<void>>
  /** Saves a new order; `orderedIds` must be a permutation of the current cards' IDs. */
  reorderCards: (orderedIds: readonly string[]) => Promise<MutationResult<void>>
}

const FALLBACK_LOAD_ERROR = 'Couldn’t load your cards.'
const FALLBACK_SAVE_ERROR = 'Something went wrong. Your card wasn’t changed.'
const STALE_ORDER_ERROR = 'Your cards changed while reordering. Please try again.'
const FALLBACK_ORDER_ERROR = 'Couldn’t save the new card order.'

export function useCards(repository: CardRepository): UseCardsResult {
  const [status, setStatus] = useState<CardsStatus>('loading')
  const [cards, setCards] = useState<LoyaltyCard[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  // Incremented by reload() to re-run the loading effect.
  const [loadAttempt, setLoadAttempt] = useState(0)
  // Latest committed list, so reorderCards can validate without being
  // re-created (and re-rendering every tile) whenever the list changes.
  const cardsRef = useRef(cards)
  useEffect(() => {
    cardsRef.current = cards
  }, [cards])

  useEffect(() => {
    let cancelled = false
    repository.list().then(
      (loaded) => {
        if (cancelled) return
        setCards(loaded)
        setLoadError(null)
        setStatus('ready')
      },
      (error: unknown) => {
        if (cancelled) return
        setLoadError(messageOf(error, FALLBACK_LOAD_ERROR))
        setStatus('error')
      },
    )
    return () => {
      cancelled = true
    }
  }, [repository, loadAttempt])

  const reload = useCallback(() => {
    setStatus('loading')
    setLoadError(null)
    setLoadAttempt((n) => n + 1)
  }, [])

  const createCard = useCallback(
    async (input: NewCardInput): Promise<MutationResult<LoyaltyCard>> => {
      try {
        const card = await repository.create(input)
        // New cards join the end of the wallet, matching the stored order.
        setCards((current) => [...current, card])
        return { ok: true, value: card }
      } catch (error) {
        return { ok: false, message: messageOf(error, FALLBACK_SAVE_ERROR) }
      }
    },
    [repository],
  )

  const updateCard = useCallback(
    async (id: string, changes: CardChanges): Promise<MutationResult<LoyaltyCard>> => {
      try {
        const card = await repository.update(id, changes)
        setCards((current) =>
          current.map((existing) => (existing.id === id ? card : existing)),
        )
        return { ok: true, value: card }
      } catch (error) {
        return { ok: false, message: messageOf(error, FALLBACK_SAVE_ERROR) }
      }
    },
    [repository],
  )

  const deleteCard = useCallback(
    async (id: string): Promise<MutationResult<void>> => {
      const removeLocally = () => setCards((current) => current.filter((card) => card.id !== id))
      try {
        await repository.delete(id)
        removeLocally()
        return { ok: true, value: undefined }
      } catch (error) {
        // Already gone (e.g. deleted in another tab): the user's intent is met.
        if (error instanceof CardNotFoundError) {
          removeLocally()
          return { ok: true, value: undefined }
        }
        return { ok: false, message: messageOf(error, FALLBACK_SAVE_ERROR) }
      }
    },
    [repository],
  )

  const reorderCards = useCallback(
    async (orderedIds: readonly string[]): Promise<MutationResult<void>> => {
      if (!isPermutationOf(orderedIds, cardsRef.current)) return { ok: false, message: STALE_ORDER_ERROR }
      try {
        await repository.reorder(orderedIds)
        setCards((current) => applyOrder(current, orderedIds))
        return { ok: true, value: undefined }
      } catch (error) {
        return { ok: false, message: messageOf(error, FALLBACK_ORDER_ERROR) }
      }
    },
    [repository],
  )

  return { status, cards, loadError, reload, createCard, updateCard, deleteCard, reorderCards }
}

function isPermutationOf(ids: readonly string[], cards: readonly LoyaltyCard[]): boolean {
  if (ids.length !== cards.length || new Set(ids).size !== ids.length) return false
  return cards.every((card) => ids.includes(card.id))
}

/**
 * `current` rearranged to follow `orderedIds`. Cards the order doesn't name
 * (e.g. added in the same tick) keep their relative order at the end, so
 * nothing ever disappears from the list.
 */
function applyOrder(current: readonly LoyaltyCard[], orderedIds: readonly string[]): LoyaltyCard[] {
  const byId = new Map(current.map((card) => [card.id, card]))
  const ordered: LoyaltyCard[] = []
  for (const id of orderedIds) {
    const card = byId.get(id)
    if (card) {
      ordered.push(card)
      byId.delete(id)
    }
  }
  return ordered.concat([...byId.values()])
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}
