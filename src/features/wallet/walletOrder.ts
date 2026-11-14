/**
 * Pure wallet-order helpers shared by the management menu's move actions and
 * the composition root. Kept free of React and storage so they are trivially
 * testable.
 */

/** Keyboard move actions offered in the card menu. */
export type MoveTarget = 'first' | 'earlier' | 'later' | 'last'

/**
 * `ids` with `cardId` moved per `target`. "Earlier"/"later" are one step in
 * reading order (row-major), independent of how many columns the grid shows.
 * Moves past either end clamp; an unknown ID returns an unchanged copy.
 */
export function movedOrder(ids: readonly string[], cardId: string, target: MoveTarget): string[] {
  const from = ids.indexOf(cardId)
  if (from < 0) return ids.slice()
  const last = ids.length - 1
  const to = target === 'first' ? 0 : target === 'last' ? last : target === 'earlier' ? Math.max(0, from - 1) : Math.min(last, from + 1)
  const next = ids.slice()
  next.splice(from, 1)
  next.splice(to, 0, cardId)
  return next
}
