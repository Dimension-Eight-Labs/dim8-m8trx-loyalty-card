/**
 * Card colour palette — the single authoritative source for every card
 * surface (wallet tile, card-menu header, icon preview, checkout band,
 * colour picker).
 *
 * Palette: DIM8 industrial metallic, approved and locked by the owner for
 * v0.6.1. Names, hex values and order are authoritative; do not tune them
 * here without owner approval. Colours are flat solid fills by design — no
 * gradients, highlights or textures (a brushed-metal treatment would need a
 * separate review).
 *
 * Identifiers: cards store a palette id (not a raw colour). The ids below are
 * LEGACY OPAQUE PERSISTENCE KEYS retained from the earlier bright palette so
 * existing IndexedDB records and previously exported `.m8trx` backups keep
 * validating and rendering without a migration. An id's spelling no longer
 * describes its appearance (e.g. `blue` is Gunmetal); `label` and
 * `background` define what the user sees. Never rename an id: that would
 * orphan stored cards and break restore of older backups, and the Python
 * splitting utility (scripts/split-m8trx-backup.py) keeps a parity copy of
 * the id set.
 *
 * Foreground: each entry carries the one approved foreground (`text`) shared
 * by the store name AND the category icon (CardCategoryIcon draws with
 * currentColor). Soft Silver #E8ECEB on the eleven dark colours, Charcoal
 * #1A1A1A on Ivory only. Components must use this value rather than
 * computing their own.
 *
 * Contrast (WCAG 2.x, computed from these hex values in tileColors.test.ts):
 * all pairs reach 3:1 (graphical objects / large text). Three approved
 * combinations fall below 4.5:1 for normal-size text — Brushed Steel 3.45:1,
 * Copper 3.97:1, Antique Gold 3.36:1. These are recorded as owner-reported
 * exceptions, not silently corrected.
 */
export interface TileColor {
  /** Legacy opaque persistence key; see the module comment. */
  id: string
  /** Approved colour name; visible in the picker and used as its accessible name. */
  label: string
  background: string
  /** Shared foreground for the card title and category icon. */
  text: string
}

/** Soft Silver: approved foreground on the eleven dark palette colours. */
export const SOFT_SILVER = '#E8ECEB'
/** Charcoal: approved foreground on Ivory only. */
export const CHARCOAL = '#1A1A1A'

/* Approved order — the picker renders entries in exactly this sequence. */
export const TILE_COLORS: readonly TileColor[] = [
  { id: 'blue', label: 'Gunmetal', background: '#414A52', text: SOFT_SILVER },
  { id: 'teal', label: 'Brushed Steel', background: '#727F89', text: SOFT_SILVER },
  { id: 'brown', label: 'Obsidian Black', background: '#1F2124', text: SOFT_SILVER },
  { id: 'orange', label: 'Copper', background: '#A26443', text: SOFT_SILVER },
  { id: 'green', label: 'Deep Emerald', background: '#235C52', text: SOFT_SILVER },
  { id: 'indigo', label: 'Midnight Blue', background: '#244669', text: SOFT_SILVER },
  { id: 'pink', label: 'Burgundy', background: '#723B4B', text: SOFT_SILVER },
  { id: 'slate', label: 'Graphite', background: '#34383D', text: SOFT_SILVER },
  { id: 'red', label: 'Oxblood Red', background: '#892F32', text: SOFT_SILVER },
  { id: 'yellow', label: 'Antique Gold', background: '#9B7B20', text: SOFT_SILVER },
  { id: 'white', label: 'Ivory', background: '#E5E0D1', text: CHARCOAL },
  { id: 'purple', label: 'Deep Violet', background: '#51436C', text: SOFT_SILVER },
] as const

/** Fallback for unknown ids (e.g. a record from a future version): Midnight Blue. */
export const DEFAULT_TILE_COLOR_ID = 'indigo'

export function isTileColorId(id: unknown): id is string {
  return typeof id === 'string' && TILE_COLORS.some((color) => color.id === id)
}

/** Palette entry for an id; unknown ids (e.g. from a future version) use the default. */
export function tileColor(id: string): TileColor {
  return (
    TILE_COLORS.find((color) => color.id === id) ??
    (TILE_COLORS.find((color) => color.id === DEFAULT_TILE_COLOR_ID) as TileColor)
  )
}

/** Deterministic colour for migrated and newly added cards, so cards get varied tiles. */
export function colorForIndex(index: number): string {
  return (TILE_COLORS[index % TILE_COLORS.length] as TileColor).id
}
