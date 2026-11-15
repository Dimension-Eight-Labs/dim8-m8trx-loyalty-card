/**
 * Card foreground regression tests (v0.6.1 consistency pass).
 *
 * Rule under test: every surface that shows a card in its own color (wallet
 * tile, card-menu identity header, checkout upper band, icon-picker preview)
 * sets the palette foreground (`TileColor.text`) once on a container, and the
 * card name and category icon both inherit it. Physical-iPhone testing found
 * the global `h1, h2 { color }` rule in base.css overriding that inherited
 * color on the menu and checkout headings, so the name stayed light on
 * Yellow / White / Orange while the icon beside it was charcoal.
 *
 * Method: the real base.css and app.css are injected into jsdom so its
 * cascade runs (including the global heading rule). jsdom does not evaluate
 * CSS custom properties, so `var(--token)` references are substituted with
 * their tokens.css values first, and `var(--card-on-accent)` (which
 * CheckoutScreen sets inline on the card face) with the palette value for the
 * color under test — the same value a browser would resolve. These are host
 * tests of the cascade and DOM, not of rendered pixels; the real-browser and
 * iPhone checks are listed in the task handoff.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CardMenu } from '../wallet/CardMenu.tsx'
import { CardTile } from '../wallet/CardTile.tsx'
import { CheckoutScreen } from '../checkout/CheckoutScreen.tsx'
import type { LoyaltyCard } from './card.ts'
import { CardCategoryIcon } from './CardCategoryIcon.tsx'
import { IconPicker } from './IconPicker.tsx'
import { TILE_COLORS } from './tileColors.ts'

// ---- Stylesheet with custom properties resolved for jsdom -------------------

// Read from disk: Vitest runs with `css: false`, which also empties `?raw` CSS imports.
const stylesDir = join(import.meta.dirname, '../../styles')
const read = (name: string) => readFileSync(join(stylesDir, name), 'utf-8')
const tokensCss = read('tokens.css')
const baseCss = read('base.css')
const appCss = read('app.css')

/** `--name: value` pairs declared in tokens.css. */
const tokens = new Map(Array.from(tokensCss.matchAll(/(--[\w-]+):\s*([^;]+);/g), (m) => [m[1]!, m[2]!.trim()]))

/** Replaces `var(--token)` (repeatedly, for tokens defined via other tokens). */
function resolveTokens(css: string): string {
  let out = css
  for (let i = 0; i < 5; i += 1) out = out.replace(/var\((--[\w-]+)\)/g, (whole, name: string) => tokens.get(name) ?? whole)
  return out
}

const baseAndApp = resolveTokens(baseCss + '\n' + appCss)

/** The resolved light heading color base.css gives every h1/h2. */
const HEADING_COLOR = tokens.get('--dim8-text')!

function installStyles(onAccent: string) {
  const style = document.createElement('style')
  style.dataset.test = 'card-foreground'
  style.textContent = baseAndApp.replaceAll('var(--card-on-accent)', onAccent)
  document.head.append(style)
}

afterEach(() => {
  document.head.querySelectorAll('style[data-test="card-foreground"]').forEach((node) => node.remove())
})

// jsdom has no object URLs (CheckoutScreen's barcode view may ask for one).
const originalUrl = { create: URL.createObjectURL, revoke: URL.revokeObjectURL }
beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:fake')
  URL.revokeObjectURL = vi.fn()
})
afterEach(() => {
  URL.createObjectURL = originalUrl.create
  URL.revokeObjectURL = originalUrl.revoke
})

// ---- Helpers ------------------------------------------------------------------

function makeCard(color: string): LoyaltyCard {
  const at = '2026-01-01T00:00:00.000Z'
  return {
    id: 'a',
    schemaVersion: 2,
    storeName: 'Hardware Depot',
    color,
    icon: 'hardware',
    barcode: { kind: 'generated', format: 'code128', value: '1' },
    createdAt: at,
    updatedAt: at,
  }
}

function rgb(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  return `rgb(${r}, ${g}, ${b})`
}

const color = (element: Element) => getComputedStyle(element).color

/** Asserts the title and the icon inside `surface` both compute to `expected`. */
function expectSharedForeground(surface: HTMLElement, title: HTMLElement, expected: string) {
  const icon = surface.querySelector('svg[data-icon="hardware"]')
  expect(icon, 'category icon').not.toBeNull()
  // The icon draws in currentColor, so its computed color is its stroke color.
  expect(icon!.querySelector('g')).toHaveAttribute('stroke', 'currentColor')
  expect(color(surface)).toBe(rgb(expected))
  expect(color(title)).toBe(rgb(expected))
  expect(color(icon!)).toBe(rgb(expected))
}

// ---- Palette mapping ----------------------------------------------------------

describe('palette foreground', () => {
  // Global heading color must be different from the charcoal foreground,
  // otherwise the cascade tests below could not tell the two apart.
  it('differs from the global heading color the cards must not inherit', () => {
    expect(HEADING_COLOR.toLowerCase()).not.toBe('#1a1a1a')
    expect(baseAndApp).toMatch(/h1,\s*h2\s*\{\s*color:/)
  })
})

describe.each(TILE_COLORS.map((c) => [c.label, c] as const))('%s card', (_label, palette) => {
  it('tile: the name and icon share the palette foreground', () => {
    installStyles(palette.text)
    render(
      <ul>
        <CardTile card={makeCard(palette.id)} onOpen={() => {}} onOpenMenu={() => {}} />
      </ul>,
    )
    const tile = document.querySelector<HTMLElement>('li.tile')!
    expectSharedForeground(tile, tile.querySelector<HTMLElement>('.tile__name')!, palette.text)
  })

  it('card-menu header: the h2 title is not overridden by the global heading color', async () => {
    installStyles(palette.text)
    render(
      <CardMenu
        card={makeCard(palette.id)}
        position={0}
        count={1}
        onClose={() => {}}
        onRename={async () => null}
        onRecolor={async () => null}
        onChangeIcon={async () => null}
        onMove={async () => null}
        onDelete={() => {}}
      />,
    )
    const header = screen.getByTestId('card-menu-header')
    const title = within(header).getByRole('heading', { level: 2 })
    expectSharedForeground(header, title, palette.text)
  })

  it('checkout band: the h1 title is not overridden by the global heading color', () => {
    installStyles(palette.text)
    render(<CheckoutScreen cards={[makeCard(palette.id)]} cardId="a" onChangeCard={() => {}} onClose={() => {}} />)
    const face = screen.getByTestId('checkout-card')
    expect(face.style.getPropertyValue('--card-on-accent')).toBe(palette.text)
    const band = within(face).getByTestId('checkout-band')
    expectSharedForeground(band, within(band).getByRole('heading', { level: 1 }), palette.text)
  })

  it('icon picker preview: the icon uses the same palette foreground', () => {
    installStyles(palette.text)
    render(<IconPicker name="t" value="hardware" color={palette.id} onChange={() => {}} />)
    const swatch = screen.getByRole('radio', { name: 'Hardware' }).parentElement!.querySelector<HTMLElement>('.icon-picker__swatch')!
    expect(color(swatch)).toBe(rgb(palette.text))
    expect(color(swatch.querySelector('svg[data-icon="hardware"]')!)).toBe(rgb(palette.text))
  })
})

// ---- Hardware artwork -------------------------------------------------------------

describe('Hardware category icon', () => {
  it('draws a hex nut and bolt (not the old wrench) under the unchanged `hardware` id', () => {
    const { container } = render(<CardCategoryIcon icon="hardware" />)
    const svg = container.querySelector('svg')!
    expect(svg).toHaveAttribute('data-icon', 'hardware')
    expect(svg).toHaveAttribute('viewBox', '0 0 24 24')
    expect(svg).toHaveAttribute('stroke-linecap', 'round')
    expect(svg).toHaveAttribute('stroke-linejoin', 'round')
    const g = svg.querySelector('g')!
    expect(g).toHaveAttribute('stroke-width', '2')
    const paths = Array.from(svg.querySelectorAll('path'), (p) => p.getAttribute('d'))
    // Bolt head, shank, thread marks, then the hexagonal nut and its hole.
    expect(paths).toEqual([
      'M4.5 3h5a1 1 0 0 1 1 1v3h-7V4a1 1 0 0 1 1-1Z',
      'M5.5 7v12.5a1.5 1.5 0 0 0 3 0V7',
      'M5.5 11l3-1.5M5.5 14.5l3-1.5M5.5 18l3-1.5',
      'M16.5 8.5l4.76 2.75v5.5L16.5 19.5l-4.76-2.75v-5.5Z',
    ])
    const hole = svg.querySelector('circle')
    expect(hole).toHaveAttribute('cx', '16.5')
    expect(hole).toHaveAttribute('cy', '14')
    // The wrench's open jaw arc is gone.
    expect(svg.innerHTML).not.toContain('a4.5 4.5 0 1 0 4.5 4.5')
    // Strokes only, no fills, no external references.
    expect(svg).toHaveAttribute('fill', 'none')
    expect(svg.querySelector('image, use, [href], [fill]:not([fill="none"])')).toBeNull()
  })
})

// ---- Icon-picker selection --------------------------------------------------------

describe('icon picker selection', () => {
  const swatchOf = (label: string) => screen.getByRole('radio', { name: label }).parentElement!.querySelector<HTMLElement>('.icon-picker__swatch')!

  it('marks the selected icon with one check mark and no other option', () => {
    render(<IconPicker name="t" value="hardware" color="yellow" onChange={() => {}} />)
    expect(screen.getAllByTestId('icon-picker-check')).toHaveLength(1)
    const check = within(swatchOf('Hardware')).getByTestId('icon-picker-check')
    expect(check.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    expect(within(swatchOf('None')).queryByTestId('icon-picker-check')).toBeNull()
    // The artwork stays in place next to the check.
    expect(swatchOf('Hardware').querySelector('svg[data-icon="hardware"]')).not.toBeNull()
  })

  it('gives None the same unambiguous check when nothing is chosen', () => {
    render(<IconPicker name="t" value={null} color="white" onChange={() => {}} />)
    expect(screen.getByRole('radio', { name: 'None' })).toBeChecked()
    expect(screen.getAllByTestId('icon-picker-check')).toHaveLength(1)
    expect(within(swatchOf('None')).getByTestId('icon-picker-check')).toBeInTheDocument()
  })

  it('sets the swatch background as --swatch-bg so the check badge inverts the palette pair', () => {
    render(<IconPicker name="t" value="fuel" color="yellow" onChange={() => {}} />)
    const swatch = swatchOf('Fuel')
    expect(swatch.style.getPropertyValue('--swatch-bg')).toBe('#fbc02d')
    expect(swatch).toHaveStyle({ color: '#1a1a1a' })
  })

  it('keeps native radio semantics and arrow-key selection', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<IconPicker name="t" value="fitness" color="blue" onChange={onChange} />)
    expect(screen.getByRole('group', { name: 'Icon' })).toBeInTheDocument()
    expect(screen.getAllByRole('radio')).toHaveLength(9)
    const fitness = screen.getByRole('radio', { name: 'Fitness' })
    expect(fitness).toBeChecked()
    fitness.focus()
    await user.keyboard('{ArrowRight}')
    expect(onChange).toHaveBeenLastCalledWith('grocery')
  })
})
