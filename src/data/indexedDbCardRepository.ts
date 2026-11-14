/**
 * IndexedDB implementation of CardRepository.
 *
 * Storage layout: database `dim8-loyalty-card` (version 2) with one object
 * store, `cards`, keyed by `id`. Records are plain LoyaltyCard objects
 * (structured-cloned, so fallback images are stored as Blobs). Data lives only
 * in this browser profile; there is no backend or sync.
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
const DB_VERSION = 2
const CARD_STORE = 'cards'

const UNAVAILABLE_MESSAGE =
  'Card storage isn’t available in this browser. Private browsing or strict storage settings can block it.'
const OPEN_FAILED_MESSAGE = 'Couldn’t open card storage.'
const BLOCKED_MESSAGE = 'Card storage is busy in another tab. Close other copies of the app and try again.'

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
   * Runs `work` in a single transaction and resolves with its result only after
   * the transaction completes. `work` may call `abort(error)` to roll back and
   * reject with a specific error.
   */
  async function transact<T>(
    mode: IDBTransactionMode,
    failureMessage: string,
    work: (store: IDBObjectStore, abort: (error: Error) => void) => () => T,
  ): Promise<T> {
    const db = await open()
    return new Promise<T>((resolve, reject) => {
      let tx: IDBTransaction
      try {
        tx = db.transaction(CARD_STORE, mode)
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
      const getResult = work(tx.objectStore(CARD_STORE), abort)

      tx.oncomplete = () => resolve(getResult())
      // A failed request (e.g. ConstraintError) aborts the transaction, which
      // rejects here. Do NOT call preventDefault() on request errors: in
      // IndexedDB that cancels the abort and lets the transaction commit.
      tx.onabort = () => reject(abortError ?? new Error(failureMessage))
    })
  }

  return {
    async list() {
      const records = await transact('readonly', 'Couldn’t load your cards.', (store) => {
        const request = store.getAll()
        return () => request.result as unknown[]
      })
      // Unreadable records (e.g. from a newer app version) are skipped, never deleted.
      return records
        .map(readCardRecord)
        .filter((card): card is LoyaltyCard => card !== null)
        .sort(compareByCreated)
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
      await transact('readwrite', 'Couldn’t save the card.', (store) => {
        store.add(card)
        return () => undefined
      })
      return card
    },

    async update(id, changes) {
      const storeName = changes.storeName?.trim()
      if (storeName !== undefined && validateStoreName(storeName)) throw new CardValidationError()
      if (changes.color !== undefined && validateColor(changes.color)) throw new CardValidationError()
      return transact('readwrite', 'Couldn’t save your changes.', (store, abort) => {
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
      await transact('readwrite', 'Couldn’t delete the card.', (store, abort) => {
        // Check existence first so deleting a vanished card is reported, not silently ignored.
        const request = store.getKey(id)
        request.onsuccess = () => {
          if (request.result === undefined) {
            abort(new CardNotFoundError())
            return
          }
          store.delete(id)
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
 */
function upgrade(db: IDBDatabase, tx: IDBTransaction, oldVersion: number): void {
  if (!db.objectStoreNames.contains(CARD_STORE)) {
    db.createObjectStore(CARD_STORE, { keyPath: 'id' })
  }
  if (oldVersion >= 1 && oldVersion < 2) {
    let index = 0
    const cursorRequest = tx.objectStore(CARD_STORE).openCursor()
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result
      if (!cursor) return
      if (isV1Record(cursor.value)) {
        cursor.update(migrateV1Record(cursor.value as Record<string, unknown>, index))
      }
      index += 1
      cursor.continue()
    }
  }
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
