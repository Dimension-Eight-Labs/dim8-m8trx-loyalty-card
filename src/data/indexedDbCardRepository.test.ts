/**
 * Persistence tests for the IndexedDB repository, run against fake-indexeddb
 * (an in-process IndexedDB implementation). Each test gets a fresh IDBFactory,
 * i.e. an empty "browser profile". These are host tests: they verify our use
 * of the IndexedDB API, not a specific browser's storage engine.
 */
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LoyaltyCard, NewCardInput } from '../features/cards/card.ts'
import { CardNotFoundError, CardValidationError } from '../features/cards/CardRepository.ts'
import { createIndexedDbCardRepository, DEFAULT_DB_NAME, type IndexedDbCardRepositoryOptions } from './indexedDbCardRepository.ts'

// Node's own Blob (structured-cloneable, unlike jsdom's). Loaded by a
// non-literal specifier so the app's browser-only type config needn't include
// Node typings.
const NODE_BUFFER: string = 'node:buffer'
const { Blob: NodeBlob } = (await import(/* @vite-ignore */ NODE_BUFFER)) as { Blob: typeof Blob }

let factory: IDBFactory

beforeEach(() => {
  factory = new IDBFactory()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** Controllable clock so ordering and timestamp assertions are deterministic. */
function clock(start = Date.parse('2026-01-01T00:00:00.000Z')) {
  let current = start
  return {
    now: () => new Date(current),
    advance: (ms = 1000) => {
      current += ms
    },
  }
}

function makeRepository(options: IndexedDbCardRepositoryOptions = {}) {
  return createIndexedDbCardRepository({ indexedDB: factory, ...options })
}

const coffee: NewCardInput = {
  storeName: 'Corner Coffee',
  color: 'teal',
  barcode: { kind: 'generated', format: 'code128', value: '0012 3456' },
}

describe('IndexedDB card repository', () => {
  it('starts empty', async () => {
    await expect(makeRepository().list()).resolves.toEqual([])
  })

  it('creates a card with an id, schema version and matching timestamps', async () => {
    const time = clock()
    const repo = makeRepository({ now: time.now })

    const card = await repo.create(coffee)

    expect(card).toMatchObject({ ...coffee, schemaVersion: 2 })
    expect(card.id).toEqual(expect.any(String))
    expect(card.createdAt).toBe('2026-01-01T00:00:00.000Z')
    expect(card.updatedAt).toBe(card.createdAt)
    await expect(repo.list()).resolves.toEqual([card])
  })

  it('trims the store name but stores barcode values exactly, leading zeros and spaces included', async () => {
    const repo = makeRepository()

    await repo.create({
      storeName: '  Market  ',
      color: 'red',
      barcode: { kind: 'generated', format: 'code128', value: ' 000123 45-AB ' },
    })
    await repo.create({ storeName: 'Grocer', color: 'red', barcode: { kind: 'generated', format: 'upca', value: '012345678905' } })

    const [market, grocer] = await makeRepository().list()
    expect(market?.storeName).toBe('Market')
    expect(market?.barcode).toEqual({ kind: 'generated', format: 'code128', value: ' 000123 45-AB ' })
    expect(grocer?.barcode).toEqual({ kind: 'generated', format: 'upca', value: '012345678905' })
  })

  it('persists a cropped-image fallback as a Blob', async () => {
    // jsdom's Blob cannot be structured-cloned (it clones to a plain object),
    // while browsers' and Node's can. Use Node's Blob so this test exercises
    // real Blob storage rather than a jsdom limitation.
    vi.stubGlobal('Blob', NodeBlob)
    const repo = makeRepository()
    const image = new Blob([new Uint8Array([137, 80, 78, 71, 1, 2, 3])], { type: 'image/png' })

    await repo.create({ storeName: 'Odd Code', color: 'slate', barcode: { kind: 'image', image, detectedFormat: 'Codabar', detectedValue: 'A123B' } })
    repo.close()

    const [stored] = await makeRepository().list()
    expect(stored?.barcode.kind).toBe('image')
    if (stored?.barcode.kind !== 'image') return
    expect(stored.barcode.detectedFormat).toBe('Codabar')
    expect(stored.barcode.detectedValue).toBe('A123B')
    expect(stored.barcode.image.size).toBe(7)
    expect(stored.barcode.image.type).toBe('image/png')
    await expect(stored.barcode.image.arrayBuffer()).resolves.toEqual(new Uint8Array([137, 80, 78, 71, 1, 2, 3]).buffer)
    vi.unstubAllGlobals()
  })

  it('allows duplicate cards', async () => {
    const repo = makeRepository()
    await repo.create(coffee)
    await repo.create(coffee)

    await expect(repo.list()).resolves.toHaveLength(2)
  })

  it('rejects invalid input without storing anything', async () => {
    const repo = makeRepository()

    await expect(repo.create({ ...coffee, storeName: ' ' })).rejects.toBeInstanceOf(CardValidationError)
    await expect(repo.create({ ...coffee, color: 'chartreuse' })).rejects.toBeInstanceOf(CardValidationError)
    await expect(
      repo.create({ ...coffee, barcode: { kind: 'generated', format: 'ean13', value: '0012345678901' } }),
    ).rejects.toBeInstanceOf(CardValidationError)
    await expect(
      repo.create({ ...coffee, barcode: { kind: 'generated', format: 'code39', value: '' } }),
    ).rejects.toBeInstanceOf(CardValidationError)
    await expect(repo.list()).resolves.toEqual([])
  })

  it('lists cards oldest first, and renaming does not reorder them', async () => {
    const time = clock()
    const repo = makeRepository({ now: time.now })
    const first = await repo.create({ ...coffee, storeName: 'First' })
    time.advance()
    await repo.create({ ...coffee, storeName: 'Second' })
    time.advance()
    await repo.update(first.id, { storeName: 'First (renamed)' })

    const names = (await repo.list()).map((card) => card.storeName)
    expect(names).toEqual(['First (renamed)', 'Second'])
  })

  it('renames and recolours, keeps createdAt and barcode, and bumps updatedAt', async () => {
    const time = clock()
    const repo = makeRepository({ now: time.now })
    const card = await repo.create(coffee)
    time.advance(60_000)

    const renamed = await repo.update(card.id, { storeName: '  Corner Café ' })
    const recoloured = await repo.update(card.id, { color: 'purple' })

    expect(renamed.storeName).toBe('Corner Café')
    expect(recoloured).toEqual({
      ...card,
      storeName: 'Corner Café',
      color: 'purple',
      updatedAt: '2026-01-01T00:01:00.000Z',
    })
    await expect(repo.list()).resolves.toEqual([recoloured])
  })

  it('rejects updating a card that does not exist', async () => {
    const repo = makeRepository()
    await expect(repo.update('missing', { storeName: 'X' })).rejects.toBeInstanceOf(CardNotFoundError)
  })

  it('rejects an invalid update and leaves the stored card unchanged', async () => {
    const repo = makeRepository()
    const card = await repo.create(coffee)

    await expect(repo.update(card.id, { storeName: '   ' })).rejects.toBeInstanceOf(CardValidationError)
    await expect(repo.update(card.id, { color: 'nope' })).rejects.toBeInstanceOf(CardValidationError)
    await expect(repo.list()).resolves.toEqual([card])
  })

  it('deletes only the requested card', async () => {
    const repo = makeRepository()
    const keep = await repo.create({ ...coffee, storeName: 'Keep' })
    const remove = await repo.create({ ...coffee, storeName: 'Remove' })

    await repo.delete(remove.id)

    await expect(repo.list()).resolves.toEqual([keep])
  })

  it('rejects deleting a card that does not exist', async () => {
    const repo = makeRepository()
    await expect(repo.delete('missing')).rejects.toBeInstanceOf(CardNotFoundError)
  })

  it('keeps cards after the repository is closed and reopened (simulated app restart)', async () => {
    const first = makeRepository()
    const card = await first.create(coffee)
    const edited = await first.update(card.id, { storeName: 'Edited' })
    const doomed = await first.create({ ...coffee, storeName: 'Doomed' })
    await first.delete(doomed.id)
    first.close()

    // A brand-new instance sharing only the underlying database, as after a reload.
    const second = makeRepository()
    await expect(second.list()).resolves.toEqual([edited])
    second.close()
  })

  it('isolates databases by name', async () => {
    await makeRepository({ dbName: 'a' }).create(coffee)
    await expect(makeRepository({ dbName: 'b' }).list()).resolves.toEqual([])
  })

  it('reports a friendly error when IndexedDB is unavailable', async () => {
    const repo = createIndexedDbCardRepository({ indexedDB: undefined })
    const original = globalThis.indexedDB
    // jsdom has no global indexedDB; make sure of that for this test.
    Reflect.deleteProperty(globalThis, 'indexedDB')
    try {
      await expect(repo.list()).rejects.toThrow(/storage isn’t available/i)
    } finally {
      if (original) globalThis.indexedDB = original
    }
  })

  it('reports a friendly error when opening fails, and retries the open on the next call', async () => {
    let attempts = 0
    const flaky = {
      open: (...args: Parameters<IDBFactory['open']>) => {
        attempts += 1
        if (attempts === 1) throw new DOMException('denied', 'SecurityError')
        return factory.open(...args)
      },
    } as unknown as IDBFactory
    const repo = createIndexedDbCardRepository({ indexedDB: flaky })

    await expect(repo.list()).rejects.toThrow(/storage isn’t available/i)
    await expect(repo.list()).resolves.toEqual([])
    expect(attempts).toBe(2)
  })

  it('surfaces a storage failure on save as a friendly error', async () => {
    let n = 0
    // Same ID twice: `add` refuses to overwrite, so the second transaction aborts.
    const repo = makeRepository({ generateId: () => (n++ < 2 ? 'fixed' : 'other') })
    await repo.create(coffee)

    await expect(repo.create(coffee)).rejects.toThrow('Couldn’t save the card.')
    await expect(repo.list()).resolves.toHaveLength(1)
  })

  it('closes its connection on versionchange so a newer schema can upgrade', async () => {
    const repo = makeRepository({ dbName: 'upgrade-test' })
    await repo.create(coffee)

    // Simulate a newer app version in another tab opening a higher version.
    await new Promise<void>((resolve, reject) => {
      const request = factory.open('upgrade-test', 4)
      request.onsuccess = () => {
        request.result.close()
        resolve()
      }
      request.onblocked = () => reject(new Error('upgrade was blocked by the open connection'))
      request.onerror = () => reject(request.error)
    })
  })
})

/** Runs `work` against the raw database (another "tab"), bypassing the repository. */
function rawWrite(work: (tx: IDBTransaction) => void, dbName = DEFAULT_DB_NAME): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = factory.open(dbName)
    request.onsuccess = () => {
      const db = request.result
      const tx = db.transaction(['cards', 'meta'], 'readwrite')
      work(tx)
      tx.oncomplete = () => {
        db.close()
        resolve()
      }
      tx.onabort = () => reject(tx.error)
    }
    request.onerror = () => reject(request.error)
  })
}

function readStoredOrder(dbName = DEFAULT_DB_NAME): Promise<unknown> {
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

describe('wallet order (v0.4.0)', () => {
  /** Three cards created at the same instant with IDs that sort opposite to creation. */
  async function threeCards() {
    const ids = ['z', 'y', 'x', 'w']
    const time = clock()
    const repo = makeRepository({ now: time.now, generateId: () => ids.shift() as string })
    const a = await repo.create({ ...coffee, storeName: 'A' })
    const b = await repo.create({ ...coffee, storeName: 'B' })
    const c = await repo.create({ ...coffee, storeName: 'C' })
    return { repo, a, b, c }
  }

  const names = async (repo: { list: () => Promise<{ storeName: string }[]> }) => (await repo.list()).map((card) => card.storeName)

  it('lists cards in the order they were added, even with identical timestamps', async () => {
    const { repo } = await threeCards()
    await expect(names(repo)).resolves.toEqual(['A', 'B', 'C'])
    await expect(readStoredOrder()).resolves.toEqual(['z', 'y', 'x'])
  })

  it('persists a manual reorder across a restart and appends new cards at the end', async () => {
    const { repo, a, b, c } = await threeCards()
    await repo.reorder([c.id, a.id, b.id])
    repo.close()

    const reopened = makeRepository({ generateId: () => 'new' })
    await expect(names(reopened)).resolves.toEqual(['C', 'A', 'B'])
    await reopened.create({ ...coffee, storeName: 'D' })
    await expect(names(reopened)).resolves.toEqual(['C', 'A', 'B', 'D'])
  })

  it('keeps positions when cards are renamed or recoloured', async () => {
    const { repo, a, b, c } = await threeCards()
    await repo.reorder([b.id, c.id, a.id])
    await repo.update(a.id, { storeName: 'A2' })
    await repo.update(b.id, { color: 'purple' })
    await expect(names(repo)).resolves.toEqual(['B', 'C', 'A2'])
  })

  it('removes deleted cards from the stored order', async () => {
    const { repo, b } = await threeCards()
    await repo.delete(b.id)
    await expect(readStoredOrder()).resolves.toEqual(['z', 'x'])
    await expect(names(repo)).resolves.toEqual(['A', 'C'])
  })

  it('rejects invalid reorder requests without saving anything', async () => {
    const { repo, a, b, c } = await threeCards()
    await repo.reorder([b.id, a.id, c.id])

    await expect(repo.reorder([a.id, b.id])).rejects.toBeInstanceOf(CardValidationError) // missing one
    await expect(repo.reorder([a.id, b.id, c.id, 'ghost'])).rejects.toBeInstanceOf(CardValidationError) // extra
    await expect(repo.reorder([a.id, a.id, b.id])).rejects.toBeInstanceOf(CardValidationError) // duplicate
    await expect(repo.reorder([a.id, b.id, 'ghost'])).rejects.toBeInstanceOf(CardValidationError) // unknown
    await expect(names(repo)).resolves.toEqual(['B', 'A', 'C'])
  })

  it('recovers from missing order metadata: oldest first, and new cards still go last', async () => {
    const time = clock()
    const ids = ['m1', 'm2', 'm3']
    const repo = makeRepository({ now: time.now, generateId: () => ids.shift() as string })
    await repo.create({ ...coffee, storeName: 'Old' })
    time.advance()
    await repo.create({ ...coffee, storeName: 'Newer' })
    repo.close()
    await rawWrite((tx) => tx.objectStore('meta').delete('walletOrder'))

    const reopened = makeRepository({ now: time.now, generateId: () => ids.shift() as string })
    await expect(names(reopened)).resolves.toEqual(['Old', 'Newer'])
    time.advance()
    await reopened.create({ ...coffee, storeName: 'Newest' })
    await expect(readStoredOrder()).resolves.toEqual(['m1', 'm2', 'm3'])
  })

  it('tolerates duplicate, stale and malformed order entries without hiding any card', async () => {
    const { repo, a, b, c } = await threeCards()
    repo.close()
    await rawWrite((tx) => tx.objectStore('meta').put([b.id, b.id, 'ghost', a.id], 'walletOrder'))
    // Listed cards first (B, A), then the unlisted C.
    await expect(names(makeRepository())).resolves.toEqual(['B', 'A', 'C'])

    await rawWrite((tx) => tx.objectStore('meta').put('not-a-list', 'walletOrder'))
    const recovered = makeRepository()
    await expect(names(recovered)).resolves.toHaveLength(3)
    // A full reorder rewrites clean metadata.
    await recovered.reorder([c.id, b.id, a.id])
    await expect(readStoredOrder()).resolves.toEqual([c.id, b.id, a.id])
  })

  it('keeps the position of records this version cannot read', async () => {
    const { repo, a, b, c } = await threeCards()
    repo.close()
    await rawWrite((tx) => {
      tx.objectStore('cards').put({ id: 'future', schemaVersion: 99 })
      tx.objectStore('meta').put([a.id, 'future', b.id, c.id], 'walletOrder')
    })
    const reopened = makeRepository()
    await expect(names(reopened)).resolves.toEqual(['A', 'B', 'C'])
    await reopened.reorder([c.id, b.id, a.id])
    await expect(readStoredOrder()).resolves.toEqual([c.id, b.id, a.id, 'future'])
  })

  it('reorders without rewriting card records', async () => {
    const { repo, a, b, c } = await threeCards()
    const before = await repo.list()
    await repo.reorder([c.id, b.id, a.id])
    const after = await repo.list()
    expect(after).toEqual([before[2], before[1], before[0]])
  })
})

describe('backup restore: importCards (v0.5.0)', () => {
  // Card validation checks `instanceof Blob`; use Node's (storable) Blob throughout.
  beforeEach(() => {
    vi.stubGlobal('Blob', NodeBlob)
  })

  const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 0, 255, 128]

  /** Complete cards as a parsed backup supplies them (IDs and timestamps from the source device). */
  function backupCards(): LoyaltyCard[] {
    return [
      {
        id: 'b-qr-art',
        schemaVersion: 2,
        storeName: 'Logo Shop',
        color: 'purple',
        barcode: { kind: 'image', image: new NodeBlob([new Uint8Array(PNG)], { type: 'image/png' }), detectedFormat: 'QR code', detectedValue: ' Gold ' },
        createdAt: '2025-05-01T00:00:00.000Z',
        updatedAt: '2025-06-01T00:00:00.000Z',
      },
      {
        id: 'b-linear',
        schemaVersion: 2,
        storeName: 'Grocer',
        color: 'green',
        barcode: { kind: 'generated', format: 'ean13', value: '4006381333931' },
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      },
      {
        id: 'b-text',
        schemaVersion: 2,
        storeName: 'Library',
        color: 'slate',
        barcode: { kind: 'text', value: '000123' },
        notes: 'Stamp card',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      },
    ]
  }

  async function bytes(card: LoyaltyCard | undefined) {
    if (card?.barcode.kind !== 'image') throw new Error('not an image card')
    return Array.from(new Uint8Array(await card.barcode.image.arrayBuffer()))
  }

  it('imports into an empty wallet, keeping IDs, timestamps, notes, artwork bytes and backup order', async () => {
    const repo = makeRepository()
    await repo.importCards(backupCards(), [])
    repo.close()

    // Read back through a fresh instance, as after an app restart.
    const listed = await makeRepository().list()
    expect(listed.map((card) => card.id)).toEqual(['b-qr-art', 'b-linear', 'b-text'])
    expect(listed[1]).toEqual(backupCards()[1])
    expect(listed[2]).toMatchObject({ notes: 'Stamp card', createdAt: '2024-01-01T00:00:00.000Z' })
    expect(listed[0]?.barcode).toMatchObject({ kind: 'image', detectedFormat: 'QR code', detectedValue: ' Gold ' })
    expect(await bytes(listed[0])).toEqual(PNG)
    await expect(readStoredOrder()).resolves.toEqual(['b-qr-art', 'b-linear', 'b-text'])
  })

  it('appends after existing cards without changing them', async () => {
    const repo = makeRepository({ generateId: () => 'mine' })
    const mine = await repo.create(coffee)
    await repo.importCards(backupCards().slice(1), [mine.id])

    const listed = await repo.list()
    expect(listed.map((card) => card.id)).toEqual(['mine', 'b-linear', 'b-text'])
    expect(listed[0]).toEqual(mine)
  })

  it('refuses, storing nothing, when the wallet changed since the restore was planned', async () => {
    const repo = makeRepository({ generateId: () => 'mine' })
    await repo.create(coffee)
    await expect(repo.importCards(backupCards(), [])).rejects.toThrow(/changed while restoring/)
    await expect(repo.list()).resolves.toHaveLength(1)
    await expect(readStoredOrder()).resolves.toEqual(['mine'])
  })

  it('never overwrites an existing record with the same ID, even one this version cannot read', async () => {
    const repo = makeRepository()
    await repo.list() // creates the database
    await rawWrite((tx) => tx.objectStore('cards').put({ id: 'b-text', schemaVersion: 99 }))
    await expect(repo.importCards(backupCards(), [])).rejects.toThrow(/Nothing was imported/)
    await expect(repo.list()).resolves.toEqual([])
  })

  it('rejects invalid or duplicated cards before touching storage', async () => {
    const repo = makeRepository()
    const [first] = backupCards()
    await expect(repo.importCards([first!, first!], [])).rejects.toBeInstanceOf(CardValidationError)
    await expect(repo.importCards([{ ...first!, color: 'nope' }], [])).rejects.toBeInstanceOf(CardValidationError)
    await expect(repo.importCards([{ ...first!, storeName: '' }], [])).rejects.toBeInstanceOf(CardValidationError)
    await expect(repo.list()).resolves.toEqual([])
  })

  it('rolls back every card if storage fails part-way through (interrupted restore)', async () => {
    const repo = makeRepository({ generateId: () => 'mine' })
    const mine = await repo.create(coffee)
    const { IDBObjectStore: FakeStore } = await import('fake-indexeddb')
    const realAdd = FakeStore.prototype.add
    let calls = 0
    const spy = vi.spyOn(FakeStore.prototype, 'add').mockImplementation(function (this: IDBObjectStore, ...args) {
      calls += 1
      // The first card is added, then storage "fails" on the second.
      if (calls === 2) throw new DOMException('Simulated quota failure', 'QuotaExceededError')
      return realAdd.apply(this, args)
    })
    try {
      await expect(repo.importCards(backupCards(), [mine.id])).rejects.toThrow(/Couldn’t restore the backup/)
    } finally {
      spy.mockRestore()
    }
    expect(calls).toBe(2)
    await expect(repo.list()).resolves.toEqual([mine])
    await expect(readStoredOrder()).resolves.toEqual(['mine'])
  })
})
