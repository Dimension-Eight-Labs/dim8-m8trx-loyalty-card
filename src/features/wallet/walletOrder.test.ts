/** Unit tests for the pure keyboard-move helper (host tests). */
import { describe, expect, it } from 'vitest'
import { movedOrder } from './walletOrder.ts'

describe('movedOrder', () => {
  const ids = ['a', 'b', 'c', 'd']

  it('moves one step in reading order, or to either end', () => {
    expect(movedOrder(ids, 'c', 'earlier')).toEqual(['a', 'c', 'b', 'd'])
    expect(movedOrder(ids, 'b', 'later')).toEqual(['a', 'c', 'b', 'd'])
    expect(movedOrder(ids, 'c', 'first')).toEqual(['c', 'a', 'b', 'd'])
    expect(movedOrder(ids, 'b', 'last')).toEqual(['a', 'c', 'd', 'b'])
  })

  it('clamps at the ends and ignores unknown IDs, never mutating the input', () => {
    expect(movedOrder(ids, 'a', 'earlier')).toEqual(ids)
    expect(movedOrder(ids, 'd', 'later')).toEqual(ids)
    expect(movedOrder(ids, 'zz', 'first')).toEqual(ids)
    expect(ids).toEqual(['a', 'b', 'c', 'd'])
  })
})
