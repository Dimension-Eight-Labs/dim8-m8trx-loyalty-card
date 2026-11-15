/**
 * Tile colour palette for the wallet home screen.
 *
 * Cards store a palette id (not a raw colour), so the palette can be tuned
 * later without rewriting records, and an unknown id falls back safely.
 *
 * Each colour pairs a background with the text colour that reads best on it.
 * Contrast of the store name (WCAG 2.x, computed from these hex values) is at
 * least 4.5:1 for every pair; the tile names are also large and bold.
 */
export interface TileColor {
  id: string
  /** Accessible name used by the colour picker. */
  label: string
  background: string
  text: string
}

export const TILE_COLORS: readonly TileColor[] = [
  { id: 'red', label: 'Red', background: '#c62828', text: '#ffffff' }, // 5.6:1
  { id: 'orange', label: 'Orange', background: '#f57c00', text: '#1a1a1a' }, // 6.4:1
  { id: 'yellow', label: 'Yellow', background: '#fbc02d', text: '#1a1a1a' }, // 10.5:1
  { id: 'green', label: 'Green', background: '#2e7d32', text: '#ffffff' }, // 5.1:1
  { id: 'teal', label: 'Teal', background: '#00796b', text: '#ffffff' }, // 5.3:1
  { id: 'blue', label: 'Blue', background: '#1565c0', text: '#ffffff' }, // 5.7:1
  { id: 'indigo', label: 'Indigo', background: '#3949ab', text: '#ffffff' }, // 7.7:1
  { id: 'purple', label: 'Purple', background: '#7b1fa2', text: '#ffffff' }, // 8.2:1
  { id: 'pink', label: 'Pink', background: '#d81b60', text: '#ffffff' }, // 4.9:1
  { id: 'brown', label: 'Brown', background: '#6d4c41', text: '#ffffff' }, // 7.6:1
  { id: 'slate', label: 'Slate', background: '#455a64', text: '#ffffff' }, // 7.2:1
  { id: 'white', label: 'White', background: '#eceff1', text: '#1a1a1a' }, // 15.1:1
] as const

export const DEFAULT_TILE_COLOR_ID = 'blue'

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

/**
 * True for the light palette entries (dark text: Orange, Yellow, White).
 * White category icons need a dark outline to stay legible on these; see
 * CardCategoryIcon.tsx.
 */
export function isLightTile(color: TileColor): boolean {
  return color.text !== '#ffffff'
}

/** Deterministic colour for migrated cards, so existing cards get varied tiles. */
export function colorForIndex(index: number): string {
  return (TILE_COLORS[index % TILE_COLORS.length] as TileColor).id
}
