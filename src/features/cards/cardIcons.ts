/**
 * Optional category icons for wallet tiles (v0.6.0).
 *
 * A card may carry one of these stable identifiers in its optional `icon`
 * field. "None" is represented by the field being absent, never by a sentinel
 * string, so cards created before icons existed need no migration and simply
 * show no icon.
 *
 * Identifiers are persisted (IndexedDB records and `.m8trx` backups) and are
 * mirrored in scripts/split-m8trx-backup.py (CARD_ICON_IDS); a host test
 * keeps the two lists identical. Never rename or reuse an identifier; add new
 * ones instead. Labels are user-facing and may change freely.
 *
 * Icons are chosen by the user only. The app never infers one from a card's
 * name or barcode.
 *
 * Technology-neutral: the artwork lives in CardCategoryIcon.tsx.
 */
export const CARD_ICON_IDS = ['fitness', 'grocery', 'fuel', 'hardware', 'food', 'coffee', 'retail', 'events', 'gear'] as const

export type CardIconId = (typeof CARD_ICON_IDS)[number]

export interface CardIconOption {
  id: CardIconId
  /** Category name shown in the picker and used as its accessible name. */
  label: string
}

/**
 * Picker order. "None" is offered separately by the picker itself, ahead of
 * these nine, giving ten choices: two complete rows in the five-column picker.
 */
export const CARD_ICONS: readonly CardIconOption[] = [
  { id: 'fitness', label: 'Fitness' },
  { id: 'grocery', label: 'Grocery' },
  { id: 'fuel', label: 'Fuel' },
  { id: 'hardware', label: 'Hardware' },
  { id: 'food', label: 'Food' },
  { id: 'coffee', label: 'Coffee' },
  { id: 'retail', label: 'Retail' },
  { id: 'events', label: 'Events' },
  // v0.6.1: machinery, manufacturing, engineering and industrial equipment.
  { id: 'gear', label: 'Gear' },
]

export function isCardIconId(value: unknown): value is CardIconId {
  return typeof value === 'string' && (CARD_ICON_IDS as readonly string[]).includes(value)
}
