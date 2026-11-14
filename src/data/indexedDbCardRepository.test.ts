/**
 * Persistence tests for the IndexedDB repository, run against fake-indexeddb
 * (an in-process IndexedDB implementation). Each test gets a fresh IDBFactory,
 * i.e. an empty "browser profile". These are host tests: they verify our use
 * of the IndexedDB API, not a specific browser's storage engine.
 */
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NewCardInput } from '../features/cards/card.ts'
import { CardNotFoundError, CardValidationError } from '../features/cards/CardRepository.ts'
import { createIndexedDbCardRepository, type IndexedDbCardRepositoryOptions } from './indexedDbCardRepository.ts'

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
      const request = factory.open('upgrade-test', 3)
      request.onsuccess = () => {
        request.result.close()
        resolve()
      }
      request.onblocked = () => reject(new Error('upgrade was blocked by the open connection'))
      request.onerror = () => reject(request.error)
    })
  })
})
