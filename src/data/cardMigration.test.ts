/**
 * Data-migration tests: an Iteration 2 (schema v1) database is created with
 * the exact v1 layout, then opened by the current repository. Host tests over
 * fake-indexeddb; they verify the upgrade logic, not a browser's engine.
 */
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it } from 'vitest'
import { isV1Record, migrateV1Record, readCardRecord } from './cardRecords.ts'
import { createIndexedDbCardRepository, DEFAULT_DB_NAME } from './indexedDbCardRepository.ts'

let factory: IDBFactory

beforeEach(() => {
  factory = new IDBFactory()
})

/** Iteration 2 records, exactly as that version wrote them. */
const v1Records = [
  {
    id: 'a',
    storeName: 'Corner Coffee',
    cardNumber: '000123 45-AB',
    notes: 'Stamp card',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-03-01T00:00:00.000Z',
  },
  {
    id: 'b',
    storeName: 'Grocer',
    cardNumber: '0042',
    notes: '',
    createdAt: '2026-02-01T00:00:00.000Z',
    updatedAt: '2026-02-01T00:00:00.000Z',
  },
]

/** Builds a v1 database the way Iteration 2's repository did. */
function seedV1(records: unknown[], dbName = DEFAULT_DB_NAME): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = factory.open(dbName, 1)
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore('cards', { keyPath: 'id' })
      for (const record of records) store.add(record)
    }
    request.onsuccess = () => {
      request.result.close()
      resolve()
    }
    request.onerror = () => reject(request.error)
  })
}

function readRaw(dbName = DEFAULT_DB_NAME): Promise<{ version: number; records: unknown[] }> {
  return new Promise((resolve, reject) => {
    const request = factory.open(dbName)
    request.onsuccess = () => {
      const db = request.result
      const get = db.transaction('cards').objectStore('cards').getAll()
      get.onsuccess = () => {
        resolve({ version: db.version, records: get.result })
        db.close()
      }
      get.onerror = () => reject(get.error)
    }
    request.onerror = () => reject(request.error)
  })
}

describe('Iteration 2 → 3 migration', () => {
  it('keeps every card, with the number preserved exactly and no format guessed', async () => {
    await seedV1(v1Records)
    const repo = createIndexedDbCardRepository({ indexedDB: factory })

    const cards = await repo.list()

    expect(cards.map((card) => card.id)).toEqual(['a', 'b'])
    expect(cards[0]).toMatchObject({
      id: 'a',
      schemaVersion: 2,
      storeName: 'Corner Coffee',
      barcode: { kind: 'text', value: '000123 45-AB' },
      notes: 'Stamp card',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-03-01T00:00:00.000Z',
    })
    expect(cards[1]?.barcode).toEqual({ kind: 'text', value: '0042' })
    // Varied, valid tile colours.
    expect(cards[0]?.color).not.toBe(cards[1]?.color)
    repo.close()
  })

  it('upgrades the stored records and database version', async () => {
    await seedV1(v1Records)
    const repo = createIndexedDbCardRepository({ indexedDB: factory })
    await repo.list()
    repo.close()

    const { version, records } = await readRaw()
    expect(version).toBe(3)
    expect(records).toHaveLength(2)
    expect(records.every((record) => readCardRecord(record) !== null)).toBe(true)
    expect(records.some((record) => 'cardNumber' in (record as object))).toBe(false)
  })

  it('leaves unrecognized records in place instead of deleting them', async () => {
    const stranger = { id: 'z', somethingElse: true }
    await seedV1([...v1Records, stranger])
    const repo = createIndexedDbCardRepository({ indexedDB: factory })

    await expect(repo.list()).resolves.toHaveLength(2)
    repo.close()
    const { records } = await readRaw()
    expect(records).toContainEqual(stranger)
  })

  it('migrated cards can be renamed, recoloured and deleted', async () => {
    await seedV1(v1Records)
    const repo = createIndexedDbCardRepository({ indexedDB: factory })

    const renamed = await repo.update('a', { storeName: 'Coffee', color: 'red' })
    expect(renamed).toMatchObject({ storeName: 'Coffee', color: 'red', notes: 'Stamp card' })
    await repo.delete('b')
    await expect(repo.list()).resolves.toEqual([renamed])
  })

  it('opening an empty v1 database works', async () => {
    await seedV1([])
    await expect(createIndexedDbCardRepository({ indexedDB: factory }).list()).resolves.toEqual([])
  })
})

/** Builds a v2 (v0.3.x) database: `cards` store only, no wallet-order metadata. */
function seedV2(records: unknown[], dbName = DEFAULT_DB_NAME): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = factory.open(dbName, 2)
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore('cards', { keyPath: 'id' })
      for (const record of records) store.add(record)
    }
    request.onsuccess = () => {
      request.result.close()
      resolve()
    }
    request.onerror = () => reject(request.error)
  })
}

function readOrder(dbName = DEFAULT_DB_NAME): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const request = factory.open(dbName)
    request.onsuccess = () => {
      const db = request.result
      const get = db.transaction('meta').objectStore('meta').get('walletOrder')
      get.onsuccess = () => {
        db.close()
        resolve(get.result)
      }
      get.onerror = () => reject(get.error)
    }
    request.onerror = () => reject(request.error)
  })
}

/** A v2 card record as v0.3.x wrote it. */
function v2Card(id: string, storeName: string, createdAt: string) {
  return {
    id,
    schemaVersion: 2,
    storeName,
    color: 'teal',
    barcode: { kind: 'generated', format: 'code128', value: id },
    createdAt,
    updatedAt: createdAt,
  }
}

describe('v0.3.x → v0.4.0 (schema 2 → 3) wallet-order migration', () => {
  it('seeds the wallet order from the existing display order, so nothing moves', async () => {
    // Key order (a, b, c) differs from creation order (c, a, b) on purpose.
    await seedV2([
      v2Card('a', 'Second', '2026-02-01T00:00:00.000Z'),
      v2Card('b', 'Third', '2026-03-01T00:00:00.000Z'),
      v2Card('c', 'First', '2026-01-01T00:00:00.000Z'),
    ])
    const repo = createIndexedDbCardRepository({ indexedDB: factory })

    expect((await repo.list()).map((card) => card.storeName)).toEqual(['First', 'Second', 'Third'])
    repo.close()
    await expect(readOrder()).resolves.toEqual(['c', 'a', 'b'])
    const { version, records } = await readRaw()
    expect(version).toBe(3)
    // Card records are not rewritten by this step.
    expect(records).toContainEqual(v2Card('a', 'Second', '2026-02-01T00:00:00.000Z'))
  })

  it('leaves unreadable records out of the seeded order but keeps them stored', async () => {
    const stranger = { id: 'z', schemaVersion: 99 }
    await seedV2([v2Card('a', 'Only', '2026-01-01T00:00:00.000Z'), stranger])
    const repo = createIndexedDbCardRepository({ indexedDB: factory })
    await expect(repo.list()).resolves.toHaveLength(1)
    repo.close()
    await expect(readOrder()).resolves.toEqual(['a'])
    expect((await readRaw()).records).toContainEqual(stranger)
  })

  it('migrated v0.3.x cards can be reordered and keep the new order after a restart', async () => {
    await seedV2([v2Card('a', 'A', '2026-01-01T00:00:00.000Z'), v2Card('b', 'B', '2026-02-01T00:00:00.000Z')])
    const repo = createIndexedDbCardRepository({ indexedDB: factory })
    await repo.reorder(['b', 'a'])
    repo.close()
    const reopened = createIndexedDbCardRepository({ indexedDB: factory })
    expect((await reopened.list()).map((card) => card.id)).toEqual(['b', 'a'])
  })

  it('seeds the order for a v1 database after its records are migrated', async () => {
    await seedV1(v1Records)
    const repo = createIndexedDbCardRepository({ indexedDB: factory })
    await repo.list()
    repo.close()
    await expect(readOrder()).resolves.toEqual(['a', 'b'])
  })

  it('creates an empty order for a brand-new database', async () => {
    const repo = createIndexedDbCardRepository({ indexedDB: factory })
    await repo.list()
    repo.close()
    await expect(readOrder()).resolves.toEqual([])
  })
})

describe('record helpers', () => {
  it('recognizes v1 records only', () => {
    expect(isV1Record(v1Records[0])).toBe(true)
    expect(isV1Record({ ...v1Records[0], schemaVersion: 2 })).toBe(false)
    expect(isV1Record({ id: 'x' })).toBe(false)
    expect(isV1Record(null)).toBe(false)
  })

  it('preserves unknown fields when migrating', () => {
    const migrated = migrateV1Record({ ...v1Records[0]!, extra: 1 }, 0)
    expect(migrated.extra).toBe(1)
  })

  it('rejects malformed v2 records', () => {
    const good = readCardRecord(migrateV1Record(v1Records[0]!, 0))
    expect(good).not.toBeNull()
    expect(readCardRecord({ ...good, barcode: { kind: 'generated', format: 'code93', value: '1' } })).toBeNull()
    expect(readCardRecord({ ...good, barcode: { kind: 'image', image: 'not-a-blob' } })).toBeNull()
    expect(readCardRecord({ ...good, schemaVersion: 3 })).toBeNull()
  })
})
