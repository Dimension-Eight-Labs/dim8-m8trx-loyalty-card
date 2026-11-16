/**
 * Card foreground regression tests (v0.6.1 consistency pass).
 *
 * Rule under test: every surface that shows a card in its own color (wallet
 * tile, card-menu identity header, checkout upper band, icon-picker preview)
 * sets the palette foreground (`TileColor.text`) once on a container, and the
 * card name and category icon both inherit it. Physical-iPhone testing found
 * the global `h1, h2 { color }` rule in base.css overriding that inherited
 * color on the menu and checkout headings, so the name stayed light on
 * Yellow / White / Orange while the icon beside it was charcoal. Since the
 * industrial palette the foregrounds are Soft Silver (#E8ECEB) and Charcoal
 * (#1A1A1A, Ivory only); the same rule and tests apply.
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
import { createHash } from 'node:crypto'
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
import { CARD_ICON_IDS } from './cardIcons.ts'
import { ColorPicker } from './ColorPicker.tsx'
import { IconPicker } from './IconPicker.tsx'
import { CHARCOAL, SOFT_SILVER, TILE_COLORS } from './tileColors.ts'

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
  // Global heading color must be different from both palette foregrounds,
  // otherwise the cascade tests below could not tell them apart.
  it('differs from the global heading color the cards must not inherit', () => {
    expect(HEADING_COLOR.toLowerCase()).not.toBe(CHARCOAL.toLowerCase())
    expect(HEADING_COLOR.toLowerCase()).not.toBe(SOFT_SILVER.toLowerCase())
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

  it('color picker: the swatch is the flat palette background and the check uses the palette foreground', () => {
    installStyles(palette.text)
    render(<ColorPicker name="c" value={palette.id} onChange={() => {}} />)
    const radio = screen.getByRole('radio', { name: palette.label })
    expect(radio).toBeChecked()
    const swatch = radio.parentElement!.querySelector<HTMLElement>('.color-picker__swatch')!
    expect(getComputedStyle(swatch).backgroundColor).toBe(rgb(palette.background))
    // Flat solid fill: no gradient or texture layer.
    expect(swatch.style.backgroundImage).toBe('none')
    expect(color(swatch)).toBe(rgb(palette.text))
    expect(color(swatch.querySelector('svg')!)).toBe(rgb(palette.text))
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

// ---- Gear artwork and preservation of the original eight ----------------------------

describe('Gear category icon (v0.6.1)', () => {
  it('is a symmetrical eight-tooth cog with a central circular opening, drawn like the rest of the set', () => {
    const { container } = render(<CardCategoryIcon icon="gear" />)
    const svg = container.querySelector('svg')!
    expect(svg).toHaveAttribute('data-icon', 'gear')
    expect(svg).toHaveAttribute('viewBox', '0 0 24 24')
    expect(svg).toHaveAttribute('fill', 'none')
    expect(svg).toHaveAttribute('stroke-linecap', 'round')
    expect(svg).toHaveAttribute('stroke-linejoin', 'round')
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    const g = svg.querySelector('g')!
    expect(g).toHaveAttribute('stroke', 'currentColor')
    expect(g).toHaveAttribute('stroke-width', '2')

    // Central opening: a circle at the viewBox centre.
    const hole = svg.querySelector('circle')!
    expect([hole.getAttribute('cx'), hole.getAttribute('cy'), hole.getAttribute('r')]).toEqual(['12', '12', '3'])

    // Outline: one closed path, eight tip arcs (r 10) and eight root arcs (r 7.25).
    const paths = svg.querySelectorAll('path')
    expect(paths).toHaveLength(1)
    const d = paths[0]!.getAttribute('d')!
    expect(d.endsWith('Z')).toBe(true)
    expect(d.match(/A10 10 /g)).toHaveLength(8)
    expect(d.match(/A7\.25 7\.25 /g)).toHaveLength(8)

    // Every vertex is inside the 2–22 artwork box and lies on the tip or root
    // circle about (12, 12): two tip vertices per tooth, eight teeth.
    const vertices: Array<[number, number]> = []
    const commands = d.match(/[MLA][^MLAZ]*/g)!
    for (const command of commands) {
      const values = (command.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number)
      vertices.push([values.at(-2)!, values.at(-1)!])
    }
    const radii = vertices.map(([x, y]) => Math.hypot(x - 12, y - 12))
    for (const [x, y] of vertices) {
      expect(x).toBeGreaterThanOrEqual(2)
      expect(x).toBeLessThanOrEqual(22)
      expect(y).toBeGreaterThanOrEqual(2)
      expect(y).toBeLessThanOrEqual(22)
    }
    for (const r of radii) expect(Math.min(Math.abs(r - 10), Math.abs(r - 7.25))).toBeLessThan(0.02)
    expect(radii.filter((r) => Math.abs(r - 10) < 0.02)).toHaveLength(16)

    // Strokes only, no fills, no external references.
    expect(svg.querySelector('image, use, [href], [fill]:not([fill="none"])')).toBeNull()
  })

  /*
   * The eight original category drawings are approved artwork. Their rendered
   * markup is pinned by hash (computed from the v0.6.1 baseline before Gear
   * was added), so adding an icon cannot alter an existing one.
   */
  it.each([
    ['fitness', '05ee7bf26ca98c63'],
    ['grocery', '95001455a74dfb37'],
    ['fuel', '741b18163a1b87c0'],
    ['hardware', 'b3c81ba149c7e376'],
    ['food', 'f323852af3eb2e40'],
    ['coffee', 'b1d91399dff9d700'],
    ['retail', '76da434c5bfc1143'],
    ['events', 'a70c18c089aad9db'],
  ] as const)('keeps the approved %s artwork unchanged', (icon, hash) => {
    const { container } = render(<CardCategoryIcon icon={icon} />)
    const markup = container.querySelector('svg')!.outerHTML
    expect(createHash('sha256').update(markup).digest('hex').slice(0, 16)).toBe(hash)
  })

  it('renders every icon id, including gear, with artwork', () => {
    for (const icon of CARD_ICON_IDS) {
      const { container, unmount } = render(<CardCategoryIcon icon={icon} />)
      expect(container.querySelector('g')!.children.length, icon).toBeGreaterThan(0)
      unmount()
    }
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
    render(<IconPicker name="t" value="fuel" color="white" onChange={() => {}} />)
    const swatch = swatchOf('Fuel')
    expect(swatch.style.getPropertyValue('--swatch-bg')).toBe('#E5E0D1')
    expect(swatch).toHaveStyle({ color: '#1A1A1A' })
  })

  it('offers None plus the nine categories, in order, ending with Gear (two rows of five)', () => {
    render(<IconPicker name="t" value="gear" color="petrol-teal" onChange={() => {}} />)
    const radios = screen.getAllByRole('radio') as HTMLInputElement[]
    expect(radios.map((radio) => radio.value)).toEqual(['none', ...CARD_ICON_IDS])
    expect(Array.from(document.querySelectorAll('.icon-picker__label'), (node) => node.textContent)).toEqual([
      'None',
      'Fitness',
      'Grocery',
      'Fuel',
      'Hardware',
      'Food',
      'Coffee',
      'Retail',
      'Events',
      'Gear',
    ])
    expect(radios.length % 5).toBe(0)
    expect(screen.getByRole('radio', { name: 'Gear' })).toBeChecked()
    expect(within(swatchOf('Gear')).getByTestId('icon-picker-check')).toBeInTheDocument()
    expect(swatchOf('Gear').querySelector('svg[data-icon="gear"]')).not.toBeNull()
  })

  it('keeps native radio semantics and arrow-key selection', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<IconPicker name="t" value="fitness" color="blue" onChange={onChange} />)
    expect(screen.getByRole('group', { name: 'Icon' })).toBeInTheDocument()
    expect(screen.getAllByRole('radio')).toHaveLength(10)
    const fitness = screen.getByRole('radio', { name: 'Fitness' })
    expect(fitness).toBeChecked()
    fitness.focus()
    await user.keyboard('{ArrowRight}')
    expect(onChange).toHaveBeenLastCalledWith('grocery')
  })
})

// ---- Color-picker selection ---------------------------------------------------------

describe('color picker (industrial palette)', () => {
  const optionOf = (label: string) => screen.getByRole('radio', { name: label }).closest('label')!

  it('shows the fifteen approved names, in approved order, as native radios named by those names', () => {
    render(<ColorPicker name="c" value="blue" onChange={() => {}} />)
    expect(screen.getByRole('group', { name: 'Tile color' })).toBeInTheDocument()
    const radios = screen.getAllByRole('radio')
    expect(radios).toHaveLength(15)
    expect(radios.map((radio) => radio.getAttribute('aria-label'))).toEqual(TILE_COLORS.map((c) => c.label))
    expect(radios.map((radio) => (radio as HTMLInputElement).value)).toEqual(TILE_COLORS.map((c) => c.id))
    for (const radio of radios) {
      expect(radio).toHaveAttribute('type', 'radio')
      expect(radio).toHaveAttribute('name', 'c')
    }
    // The visible names match exactly (no obsolete colours remain).
    expect(Array.from(document.querySelectorAll('.color-picker__label'), (node) => node.textContent)).toEqual([
      'Gunmetal',
      'Brushed Steel',
      'Obsidian Black',
      'Copper',
      'Deep Emerald',
      'Midnight Blue',
      'Burgundy',
      'Graphite',
      'Oxblood Red',
      'Antique Gold',
      'Ivory',
      'Deep Violet',
      'Petrol Teal',
      'Olive',
      'Dusty Rose',
    ])
  })

  it('checks exactly the selected colour and draws one check mark, on that swatch only', () => {
    render(<ColorPicker name="c" value="white" onChange={() => {}} />)
    expect(screen.getByRole('radio', { name: 'Ivory' })).toBeChecked()
    expect(screen.getAllByRole('radio').filter((radio) => (radio as HTMLInputElement).checked)).toHaveLength(1)
    const swatches = screen.getAllByTestId('color-picker-swatch')
    expect(swatches.filter((swatch) => swatch.querySelector('svg'))).toEqual([optionOf('Ivory').querySelector('.color-picker__swatch')])
  })

  it('gives selected and unselected swatches the same classes and inline styles (identical cell geometry)', () => {
    render(<ColorPicker name="c" value="teal" onChange={() => {}} />)
    const selected = optionOf('Brushed Steel').querySelector<HTMLElement>('.color-picker__swatch')!
    const unselected = optionOf('Gunmetal').querySelector<HTMLElement>('.color-picker__swatch')!
    expect(selected.className).toBe(unselected.className)
    // Only the palette colours differ inline; no border, ring or size is set.
    const keys = (el: HTMLElement) => Array.from(el.style).sort()
    expect(keys(selected)).toEqual(keys(unselected))
    expect(keys(selected).filter((k) => /^(width|height|min-|max-|border|outline|box-shadow|padding|margin)/.test(k))).toEqual([])
    expect(selected.style.backgroundImage).toBe('none')
  })

  it('selects by click and by arrow keys', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<ColorPicker name="c" value="blue" onChange={onChange} />)
    await user.click(screen.getByText('Antique Gold'))
    expect(onChange).toHaveBeenLastCalledWith('yellow')
    const gunmetal = screen.getByRole('radio', { name: 'Gunmetal' })
    gunmetal.focus()
    await user.keyboard('{ArrowRight}')
    expect(onChange).toHaveBeenLastCalledWith('teal')
  })
})
