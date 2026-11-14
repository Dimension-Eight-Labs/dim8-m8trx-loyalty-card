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
 */
import { useCallback, useEffect, useState } from 'react'
import { compareByCreated, type CardChanges, type LoyaltyCard, type NewCardInput } from './card.ts'
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
}

const FALLBACK_LOAD_ERROR = 'Couldn’t load your cards.'
const FALLBACK_SAVE_ERROR = 'Something went wrong. Your card wasn’t changed.'

export function useCards(repository: CardRepository): UseCardsResult {
  const [status, setStatus] = useState<CardsStatus>('loading')
  const [cards, setCards] = useState<LoyaltyCard[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  // Incremented by reload() to re-run the loading effect.
  const [loadAttempt, setLoadAttempt] = useState(0)

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
        setCards((current) => [...current, card].sort(compareByCreated))
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

  return { status, cards, loadError, reload, createCard, updateCard, deleteCard }
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}
