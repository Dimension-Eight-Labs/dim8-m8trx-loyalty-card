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
    expect(version).toBe(2)
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
