/**
 * IndexedDB implementation of CardRepository.
 *
 * Storage layout: database `dim8-loyalty-card` (version 3) with two object
 * stores:
 * - `cards`, keyed by `id`. Records are plain LoyaltyCard objects
 *   (structured-cloned, so fallback images are stored as Blobs).
 * - `meta`, a small key/value store with out-of-line keys. Its `walletOrder`
 *   entry is the user's tile order: an array of card IDs (v0.4.0).
 * Data lives only in this browser profile; there is no backend or sync.
 *
 * Wallet order lives apart from the card records on purpose: reordering
 * rewrites one small array instead of every card (and its stored artwork),
 * and rename/recolour can never move a card by accident. The order is read
 * defensively (see `reconcileOrder`): listed IDs come first, readable cards
 * missing from the list follow oldest-first, and stale or duplicate IDs are
 * ignored, so damaged metadata can reorder the wallet but never hide a card.
 *
 * Schema upgrades run inside the version-change transaction (see `upgrade`
 * and src/data/cardRecords.ts). If any step fails, IndexedDB aborts the whole
 * upgrade and the database stays at the old version with its data intact.
 *
 * Durability: every mutation resolves only after its transaction fires
 * `complete`, so the UI never reports a save that IndexedDB did not commit.
 *
 * Failure behaviour: open, blocked, transaction, and "IndexedDB unavailable"
 * failures all reject with user-presentable Error messages. There is
 * deliberately no fallback to another storage mechanism; the UI reports the
 * failure and offers a retry. A failed open is not cached, so a retry really
 * re-attempts it.
 *
 * Upgrades: if another tab opens a newer schema version, this connection is
 * closed on `versionchange` and transparently reopened on next use, so it
 * never blocks the upgrade.
 */
import {
  CARD_SCHEMA_VERSION,
  compareByCreated,
  validateColor,
  validateNewCard,
  validateStoreName,
  type LoyaltyCard,
} from '../features/cards/card.ts'
import {
  CardNotFoundError,
  CardValidationError,
  type CardRepository,
} from '../features/cards/CardRepository.ts'
import { isV1Record, migrateV1Record, readCardRecord } from './cardRecords.ts'

export const DEFAULT_DB_NAME = 'dim8-loyalty-card'
/** Bump with a matching migration step in `upgrade` whenever the schema changes. */
const DB_VERSION = 3
const CARD_STORE = 'cards'
const META_STORE = 'meta'
const ORDER_KEY = 'walletOrder'

const UNAVAILABLE_MESSAGE =
  'Card storage isn’t available in this browser. Private browsing or strict storage settings can block it.'
const OPEN_FAILED_MESSAGE = 'Couldn’t open card storage.'
const BLOCKED_MESSAGE = 'Card storage is busy in another tab. Close other copies of the app and try again.'
const REORDER_FAILED_MESSAGE = 'Couldn’t save the new card order.'
const ORDER_CHANGED_MESSAGE = 'Your cards changed while reordering. Please try again.'

export interface IndexedDbCardRepositoryOptions {
  /** Database name; tests use unique names for isolation. */
  dbName?: string
  /** IDBFactory to use; defaults to the global `indexedDB`. */
  indexedDB?: IDBFactory
  /** Clock, injectable for deterministic timestamps in tests. */
  now?: () => Date
  /** ID generator, injectable for tests. */
  generateId?: () => string
}

export interface IndexedDbCardRepository extends CardRepository {
  /** Closes the open connection, if any. Later calls reopen it. */
  close(): void
}

export function createIndexedDbCardRepository(
  options: IndexedDbCardRepositoryOptions = {},
): IndexedDbCardRepository {
  const dbName = options.dbName ?? DEFAULT_DB_NAME
  const now = options.now ?? (() => new Date())
  const generateId = options.generateId ?? generateCardId
  let connection: Promise<IDBDatabase> | null = null

  function getFactory(): IDBFactory | undefined {
    return options.indexedDB ?? (typeof indexedDB === 'undefined' ? undefined : indexedDB)
  }

  function open(): Promise<IDBDatabase> {
    if (connection) return connection

    const pending = new Promise<IDBDatabase>((resolve, reject) => {
      const factory = getFactory()
      if (!factory) {
        reject(new Error(UNAVAILABLE_MESSAGE))
        return
      }

      let request: IDBOpenDBRequest
      try {
        request = factory.open(dbName, DB_VERSION)
      } catch {
        // Some browsers throw synchronously (e.g. SecurityError) when storage is disabled.
        reject(new Error(UNAVAILABLE_MESSAGE))
        return
      }

      request.onupgradeneeded = (event) => {
        // `transaction` is the version-change transaction; non-null here.
        upgrade(request.result, request.transaction as IDBTransaction, event.oldVersion)
      }
      // `blocked` means an older connection elsewhere is delaying an upgrade.
      // Report it rather than hang; if the open later succeeds anyway, close
      // that late connection because this attempt was already rejected.
      let rejected = false
      request.onblocked = () => {
        rejected = true
        reject(new Error(BLOCKED_MESSAGE))
      }
      request.onerror = (event) => {
        event.preventDefault()
        rejected = true
        reject(new Error(OPEN_FAILED_MESSAGE))
      }
      request.onsuccess = () => {
        const db = request.result
        if (rejected) {
          db.close()
          return
        }
        db.onversionchange = () => {
          db.close()
          connection = null
        }
        // The browser may close the connection itself (e.g. storage cleared).
        db.onclose = () => {
          connection = null
        }
        resolve(db)
      }
    })

    connection = pending
    // Do not cache a failed open: the next call (e.g. a user retry) tries again.
    pending.catch(() => {
      if (connection === pending) connection = null
    })
    return pending
  }

  /**
   * Runs `work` in a single transaction over `stores` and resolves with its
   * result only after the transaction completes. `work` may call
   * `abort(error)` to roll back and reject with a specific error. Card and
   * order changes share one transaction, so they commit or fail together.
   */
  async function transact<T>(
    stores: string[],
    mode: IDBTransactionMode,
    failureMessage: string,
    work: (tx: IDBTransaction, abort: (error: Error) => void) => () => T,
  ): Promise<T> {
    const db = await open()
    return new Promise<T>((resolve, reject) => {
      let tx: IDBTransaction
      try {
        tx = db.transaction(stores, mode)
      } catch {
        // The connection may have been closed underneath us; reopen next time.
        connection = null
        reject(new Error(failureMessage))
        return
      }

      let abortError: Error | null = null
      const abort = (error: Error) => {
        abortError = error
        tx.abort()
      }
      const getResult = work(tx, abort)

      tx.oncomplete = () => resolve(getResult())
      // A failed request (e.g. ConstraintError) aborts the transaction, which
      // rejects here. Do NOT call preventDefault() on request errors: in
      // IndexedDB that cancels the abort and lets the transaction commit.
      tx.onabort = () => reject(abortError ?? new Error(failureMessage))
    })
  }

  return {
    async list() {
      const { records, order } = await transact([CARD_STORE, META_STORE], 'readonly', 'Couldn’t load your cards.', (tx) => {
        const cardsRequest = tx.objectStore(CARD_STORE).getAll()
        const orderRequest = tx.objectStore(META_STORE).get(ORDER_KEY)
        return () => ({ records: cardsRequest.result as unknown[], order: readOrder(orderRequest.result) })
      })
      // Unreadable records (e.g. from a newer app version) are skipped, never deleted.
      const cards = records.map(readCardRecord).filter((card): card is LoyaltyCard => card !== null)
      return reconcileOrder(cards, order)
    },

    async create(input) {
      if (validateNewCard(input)) throw new CardValidationError()
      const timestamp = now().toISOString()
      const card: LoyaltyCard = {
        id: generateId(),
        schemaVersion: CARD_SCHEMA_VERSION,
        storeName: input.storeName.trim(),
        color: input.color,
        // Stored exactly as captured: barcode values are never trimmed.
        barcode: input.barcode,
        createdAt: timestamp,
        updatedAt: timestamp,
      }
      // `add` (not `put`) so an ID collision fails instead of overwriting.
      // The new card goes to the end of the wallet order in the same
      // transaction, so a card is never saved without its position.
      await transact([CARD_STORE, META_STORE], 'readwrite', 'Couldn’t save the card.', (tx) => {
        const cards = tx.objectStore(CARD_STORE)
        const meta = tx.objectStore(META_STORE)
        cards.add(card)
        const orderRequest = meta.get(ORDER_KEY)
        orderRequest.onsuccess = () => {
          const stored = readOrder(orderRequest.result)
          if (stored) {
            meta.put([...stored.filter((id) => id !== card.id), card.id], ORDER_KEY)
            return
          }
          // Missing or damaged metadata: rebuild it from the cards that the
          // wallet currently shows (oldest first), then append the new card.
          const allRequest = cards.getAll()
          allRequest.onsuccess = () => {
            const existing = (allRequest.result as unknown[])
              .map(readCardRecord)
              .filter((item): item is LoyaltyCard => item !== null && item.id !== card.id)
              .sort(compareByCreated)
              .map((item) => item.id)
            meta.put([...existing, card.id], ORDER_KEY)
          }
        }
        return () => undefined
      })
      return card
    },

    async update(id, changes) {
      const storeName = changes.storeName?.trim()
      if (storeName !== undefined && validateStoreName(storeName)) throw new CardValidationError()
      if (changes.color !== undefined && validateColor(changes.color)) throw new CardValidationError()
      // Touches only the card record: wallet order is deliberately left alone.
      return transact([CARD_STORE], 'readwrite', 'Couldn’t save your changes.', (tx, abort) => {
        const store = tx.objectStore(CARD_STORE)
        let updated: LoyaltyCard | null = null
        const request = store.get(id)
        request.onsuccess = () => {
          const existing = readCardRecord(request.result)
          if (!existing) {
            abort(new CardNotFoundError())
            return
          }
          // Patch the raw record so fields this version doesn't know survive.
          const record = {
            ...(request.result as object),
            ...(storeName !== undefined ? { storeName } : {}),
            ...(changes.color !== undefined ? { color: changes.color } : {}),
            updatedAt: now().toISOString(),
          }
          updated = readCardRecord(record)
          store.put(record)
        }
        return () => updated as LoyaltyCard
      })
    },

    async delete(id) {
      await transact([CARD_STORE, META_STORE], 'readwrite', 'Couldn’t delete the card.', (tx, abort) => {
        const store = tx.objectStore(CARD_STORE)
        const meta = tx.objectStore(META_STORE)
        // Check existence first so deleting a vanished card is reported, not silently ignored.
        const request = store.getKey(id)
        request.onsuccess = () => {
          if (request.result === undefined) {
            abort(new CardNotFoundError())
            return
          }
          store.delete(id)
          const orderRequest = meta.get(ORDER_KEY)
          orderRequest.onsuccess = () => {
            const stored = readOrder(orderRequest.result)
            if (stored) meta.put(stored.filter((item) => item !== id), ORDER_KEY)
          }
        }
        return () => undefined
      })
    },

    async reorder(orderedIds) {
      // Cheap shape check before touching storage; the permutation check
      // against the stored cards happens inside the transaction.
      if (!Array.isArray(orderedIds) || orderedIds.some((id) => typeof id !== 'string') || new Set(orderedIds).size !== orderedIds.length) {
        throw new CardValidationError(ORDER_CHANGED_MESSAGE)
      }
      await transact([CARD_STORE, META_STORE], 'readwrite', REORDER_FAILED_MESSAGE, (tx, abort) => {
        const cardsRequest = tx.objectStore(CARD_STORE).getAll()
        const meta = tx.objectStore(META_STORE)
        const orderRequest = meta.get(ORDER_KEY)
        // Requests complete in the order they were made, so both results are
        // available once the order request succeeds.
        orderRequest.onsuccess = () => {
          const records = cardsRequest.result as unknown[]
          const visible = new Set<string>()
          const unreadable = new Set<string>()
          for (const record of records) {
            const card = readCardRecord(record)
            if (card) visible.add(card.id)
            else if (isObject(record) && typeof record.id === 'string') unreadable.add(record.id)
          }
          // The request must name every visible card exactly once, and
          // nothing else; otherwise another tab changed the wallet meanwhile.
          if (orderedIds.length !== visible.size || orderedIds.some((id) => !visible.has(id))) {
            abort(new CardValidationError(ORDER_CHANGED_MESSAGE))
            return
          }
          // Keep positions for records this version can't read (e.g. written
          // by a newer app) so a downgrade-then-upgrade doesn't lose them.
          const kept = (readOrder(orderRequest.result) ?? []).filter((id) => unreadable.has(id))
          meta.put([...orderedIds, ...kept], ORDER_KEY)
        }
        return () => undefined
      })
    },

    close() {
      const current = connection
      connection = null
      current?.then((db) => db.close()).catch(() => {})
    },
  }
}

/**
 * Schema migrations, applied in order from the stored version inside the
 * version-change transaction. A thrown error or failed request aborts the
 * upgrade, leaving the previous version and its records untouched.
 *
 * - 0 → 1: create the `cards` store.
 * - 1 → 2: rewrite Iteration 2 card records into the v2 shape (see
 *   cardRecords.ts). Nothing is deleted; unrecognized records are left as is.
 * - 2 → 3: create the `meta` store and seed `walletOrder` with the cards'
 *   existing display order (oldest first, then by ID), so upgrading does not
 *   visibly rearrange anyone's wallet. Card records are not rewritten.
 *
 * Downgrade note: a v0.3.x build opening a version-3 database fails with a
 * version error and shows its "Couldn't open card storage" message; data is
 * untouched.
 */
function upgrade(db: IDBDatabase, tx: IDBTransaction, oldVersion: number): void {
  if (!db.objectStoreNames.contains(CARD_STORE)) {
    db.createObjectStore(CARD_STORE, { keyPath: 'id' })
  }
  const needsOrder = !db.objectStoreNames.contains(META_STORE)
  if (needsOrder) db.createObjectStore(META_STORE)

  if (oldVersion >= 1 && oldVersion < 2) {
    let index = 0
    const cursorRequest = tx.objectStore(CARD_STORE).openCursor()
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result
      if (!cursor) {
        // Seed only after every v1 record has been rewritten, so the order
        // is computed from readable v2 cards.
        if (needsOrder) seedOrder(tx)
        return
      }
      if (isV1Record(cursor.value)) {
        cursor.update(migrateV1Record(cursor.value as Record<string, unknown>, index))
      }
      index += 1
      cursor.continue()
    }
  } else if (needsOrder) {
    seedOrder(tx)
  }
}

/** Writes the current oldest-first order of readable cards as `walletOrder`. */
function seedOrder(tx: IDBTransaction): void {
  const request = tx.objectStore(CARD_STORE).getAll()
  request.onsuccess = () => {
    const ids = (request.result as unknown[])
      .map(readCardRecord)
      .filter((card): card is LoyaltyCard => card !== null)
      .sort(compareByCreated)
      .map((card) => card.id)
    tx.objectStore(META_STORE).put(ids, ORDER_KEY)
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** The stored order, or null when it is missing or not an array of strings. */
function readOrder(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((id) => typeof id === 'string') ? (value as string[]) : null
}

/**
 * Applies the stored order to the readable cards. Listed IDs come first, in
 * list order; duplicates and IDs with no readable card are skipped; readable
 * cards the list doesn't mention follow oldest-first. Every readable card is
 * returned exactly once, whatever state the metadata is in.
 */
export function reconcileOrder(cards: LoyaltyCard[], order: readonly string[] | null): LoyaltyCard[] {
  const byId = new Map(cards.map((card) => [card.id, card]))
  const result: LoyaltyCard[] = []
  for (const id of order ?? []) {
    const card = byId.get(id)
    if (!card) continue
    result.push(card)
    byId.delete(id)
  }
  return result.concat([...byId.values()].sort(compareByCreated))
}

/**
 * Random card ID. `crypto.randomUUID` only exists in secure contexts, so fall
 * back to `getRandomValues` (available everywhere) when the app is served over
 * plain HTTP on a LAN address during testing.
 */
function generateCardId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}
