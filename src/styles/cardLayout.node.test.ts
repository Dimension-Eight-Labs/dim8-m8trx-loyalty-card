/**
 * Stylesheet invariants for the card surfaces refined in v0.6.1: the short
 * wallet tile, the card-menu header, and the checkout card's bands. Host test
 * reading app.css (jsdom does not lay out CSS); it guards the rules the
 * layout depends on, not the rendered pixels, which are a physical-iPhone
 * check.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(join(import.meta.dirname, 'app.css'), 'utf-8')
const baseCss = readFileSync(join(import.meta.dirname, 'base.css'), 'utf-8')

/** Declarations of `selector`'s rule with comments removed and whitespace collapsed. */
function normalized(selector: string): string {
  return rule(selector)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(';')
    .map((declaration) => declaration.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('; ')
}

/** The declarations of the first rule whose selector is exactly `selector`. */
function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(css)
  expect(match, `rule for ${selector}`).not.toBeNull()
  return match![1]!
}

/*
 * Approved and locked (v0.6.1): the home-screen tile geometry. The exact
 * declarations are pinned so the consistency pass (and later work) cannot
 * change size, aspect ratio, padding, grid spacing, icon/title position or
 * touch targets by accident. Changing any of these needs owner approval.
 */
describe('locked wallet tile geometry (v0.6.1)', () => {
  it.each([
    ['.wallet-grid', 'position: relative; display: grid; grid-template-columns: repeat(auto-fill, minmax(min(9.5rem, 42vw), 1fr)); gap: var(--space-3)'],
    [
      '.tile',
      '--tile-padding: var(--space-3); --tile-icon-size: 2.125rem; position: relative; aspect-ratio: 3 / 2; border-radius: var(--radius-lg); box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.14), 0 0.5rem 1.25rem rgb(0 0 0 / 0.35); overflow: hidden',
    ],
    ['.tile__icon', 'position: absolute; top: var(--tile-padding); left: var(--tile-padding); width: var(--tile-icon-size); height: var(--tile-icon-size); pointer-events: none'],
    [
      '.tile__name',
      'display: block; width: 100%; font-family: var(--card-name-font); font-size: clamp(0.95rem, 4.1vw, 1.15rem); font-weight: 400; line-height: 1.3; letter-spacing: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis',
    ],
  ])('%s is unchanged', (selector, expected) => {
    expect(normalized(selector)).toBe(expected)
  })

  it('keeps the tile button filling the tile with the shared padding', () => {
    const open = rule('.tile__open')
    expect(open).toMatch(/width:\s*100%;/)
    expect(open).toMatch(/height:\s*100%;/)
    expect(open).toMatch(/padding:\s*var\(--tile-padding\);/)
    expect(open).toMatch(/justify-content:\s*flex-end;/)
    expect(open).toMatch(/color:\s*inherit;/)
  })

  it('keeps the wide-screen grid spacing', () => {
    expect(css).toMatch(/\.wallet-grid\s*\{\s*grid-template-columns:\s*repeat\(auto-fill, minmax\(11rem, 1fr\)\);\s*gap:\s*var\(--space-4\);\s*\}/)
  })
})

/*
 * Card foreground cascade (v0.6.1 consistency pass). base.css colors every
 * h1/h2 with the app's light heading color; a color declared on the element
 * beats a color inherited from the card container, so each card heading must
 * explicitly inherit. cardForeground.node.test.tsx runs the real cascade in
 * jsdom for all 15 colors; these are the stylesheet contracts behind it.
 */
describe('card foreground inheritance (v0.6.1 consistency pass)', () => {
  it('still has the global heading color that card headings must opt out of', () => {
    expect(baseCss).toMatch(/h1,\s*h2\s*\{\s*color:\s*var\(--color-text\);?\s*\}/)
  })

  it.each(['.card-header__title', '.checkout__store'])('%s inherits the card container color', (selector) => {
    expect(rule(selector)).toMatch(/(^|\n)\s*color:\s*inherit;/)
  })

  it('sets no fixed color on any card title or category-icon wrapper', () => {
    for (const selector of ['.tile__name', '.tile__icon', '.card-header__icon', '.checkout__icon', '.icon-picker__icon']) {
      expect(rule(selector), selector).not.toMatch(/(^|[\s;])color:\s*(?!inherit)/)
    }
  })

  it('has no app.css rule styling h1/h2 by element that could re-override card titles', () => {
    expect(css).not.toMatch(/(^|[\s,>{}])h[1-6]\s*[,{:.[]/)
  })

  it('colors the checkout band from the palette with no hardcoded white fallback', () => {
    const top = rule('.checkout__band--top')
    expect(top).toMatch(/color:\s*var\(--card-on-accent\);/)
    expect(top).not.toMatch(/#fff/i)
  })
})

/*
 * Card menu typography (v0.6.1 consistency pass): action labels use the Add
 * Card screen's normal action typography (application font, body size,
 * standard 600 button weight) rather than the previous heavier 650.
 */
describe('card menu typography (v0.6.1 consistency pass)', () => {
  it('uses the Add Card font family, body size and standard button weight', () => {
    const item = rule('.menu-list__item')
    expect(item).toMatch(/font-family:\s*var\(--font-sans\);/)
    expect(item).toMatch(/font-size:\s*var\(--font-size-md\);/)
    expect(item).toMatch(/font-weight:\s*600;/)
    expect(item).not.toMatch(/font-weight:\s*(650|700|bold)/)
    // Same weight as the shared .button rule used by the Add Card forms.
    expect(rule('.button')).toMatch(/font-weight:\s*600;/)
    // The body (and so the Add Card screen) uses the same font family and size.
    expect(baseCss).toMatch(/font-family:\s*var\(--font-sans\);\s*font-size:\s*var\(--font-size-md\);/)
  })

  it('keeps 48px rows, separators and row padding', () => {
    const item = rule('.menu-list__item')
    expect(item).toMatch(/min-height:\s*var\(--touch-target\);/)
    expect(item).toMatch(/border-top:\s*1px solid var\(--color-border\);/)
    expect(item).toMatch(/padding:\s*var\(--space-3\) var\(--space-5\);/)
  })
})

/*
 * Picker selection (v0.6.1 consistency pass): both pickers mark the selected
 * option with a check mark only. No selected-state rule may change size,
 * aspect ratio, border or ring, so selected and unselected options are
 * identical apart from the check.
 */
describe('picker selection state (v0.6.1 consistency pass)', () => {
  it('has no :checked rule that changes a swatch box, ring or border', () => {
    const checkedRules = Array.from(css.matchAll(/([^{}]*:checked[^{}]*)\{([^}]*)\}/g), (m) => [m[1]!.trim(), m[2]!] as const)
    for (const [selector, body] of checkedRules) {
      expect(body, selector).not.toMatch(/box-shadow|border|outline|width|height|aspect-ratio|padding|margin|transform|scale|inset/)
    }
    expect(css).not.toMatch(/inset 0 0 0 3px currentColor/)
  })

  it('positions the icon check badge absolutely inside the swatch, so the swatch keeps its size', () => {
    expect(rule('.icon-picker__swatch')).toMatch(/position:\s*relative;/)
    const check = rule('.icon-picker__check')
    expect(check).toMatch(/position:\s*absolute;/)
    expect(check).toMatch(/pointer-events:\s*none;/)
    // Disc in the inherited palette foreground: the badge must not set its own
    // color, or currentColor would become the swatch colour (invisible disc).
    expect(check).toMatch(/background:\s*currentColor;/)
    expect(check).not.toMatch(/(^|[\s;])color:/)
    // The check itself is drawn in the swatch colour, inverting the palette pair.
    expect(rule('.icon-picker__check .button__icon')).toMatch(/color:\s*var\(--swatch-bg\);/)
  })

  it('keeps the swatch geometry identical for every option', () => {
    expect(normalized('.icon-picker__swatch')).toBe(
      'position: relative; display: grid; place-items: center; width: 100%; min-height: var(--touch-target); aspect-ratio: 1; max-width: 3.5rem; border-radius: var(--radius-md); box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.18)',
    )
    // Since the industrial palette (v0.6.1) colour options carry a visible
    // name under the swatch, so the colour swatch matches the icon swatch.
    expect(normalized('.color-picker__swatch')).toBe(normalized('.icon-picker__swatch'))
  })

  it('keeps the whole colour option a touch target with its name visible, and the swatches flat', () => {
    expect(rule('.color-picker__option')).toMatch(/position:\s*relative;/)
    expect(rule('.color-picker__input')).toMatch(/position:\s*absolute;\s*inset:\s*0;/)
    expect(rule('.color-picker__label')).not.toMatch(/display:\s*none|clip|opacity/)
    expect(rule('.color-picker__option:has(:focus-visible) .color-picker__swatch')).toMatch(/outline:\s*3px solid var\(--color-focus\);/)
    for (const selector of ['.color-picker__swatch', '.color-picker__option']) {
      expect(rule(selector)).not.toMatch(/gradient|filter|background-image|text-shadow/)
    }
  })
})

describe('wallet tile layout (v0.6.1)', () => {
  it('is a short 3:2 rectangle, not a square', () => {
    expect(rule('.tile')).toMatch(/aspect-ratio:\s*3 \/ 2;/)
    expect(rule('.tile')).not.toMatch(/aspect-ratio:\s*1;/)
  })

  it('keeps the one-line, ellipsized name and the fixed icon slot', () => {
    const name = rule('.tile__name')
    expect(name).toMatch(/white-space:\s*nowrap/)
    expect(name).toMatch(/text-overflow:\s*ellipsis/)
    expect(name).toMatch(/overflow:\s*hidden/)
    const icon = rule('.tile__icon')
    expect(icon).toMatch(/position:\s*absolute/)
    expect(icon).toMatch(/width:\s*var\(--tile-icon-size\)/)
    expect(icon).toMatch(/height:\s*var\(--tile-icon-size\)/)
  })

  it('keeps the ⋯ options button at an accessible 44px', () => {
    const more = rule('.tile__more')
    expect(more).toMatch(/width:\s*2\.75rem/)
    expect(more).toMatch(/height:\s*2\.75rem/)
  })
})

describe('shared card identity styling (v0.6.1)', () => {
  it('uses one card-name font for the tile, the menu header and the checkout title', () => {
    for (const selector of ['.tile__name', '.card-header__title', '.checkout__store']) {
      expect(rule(selector)).toMatch(/font-family:\s*var\(--card-name-font\)/)
      expect(rule(selector)).toMatch(/font-weight:\s*400/)
    }
  })

  it('has no icon outline (halo) styling left', () => {
    expect(css).not.toMatch(/halo/i)
  })

  it('gives the menu Close button a 48px touch target that inherits the card text color', () => {
    const close = rule('.card-header__close')
    expect(close).toMatch(/width:\s*var\(--touch-target\)/)
    expect(close).toMatch(/height:\s*var\(--touch-target\)/)
    expect(close).toMatch(/color:\s*inherit/)
  })
})

/*
 * v0.6.1 correction: the ~514px menu must fit short (landscape iPhone)
 * viewports with its header and Close × visible. These are CSS contract
 * checks only; they do not prove Mobile Safari layout.
 */
describe('card menu on short viewports (v0.6.1 correction)', () => {
  it('pads the backdrop with safe-area-aware top and bottom space', () => {
    const backdrop = rule('.dialog-backdrop')
    expect(backdrop).toMatch(/--dialog-space-top:\s*max\(var\(--space-4\),\s*env\(safe-area-inset-top/)
    expect(backdrop).toMatch(/--dialog-space-bottom:\s*max\(var\(--space-4\),\s*env\(safe-area-inset-bottom/)
    expect(backdrop).toMatch(/padding:\s*var\(--dialog-space-top\)[\s\S]*var\(--dialog-space-bottom\)/)
  })

  it('caps the menu panel to the backdrop, then to the dynamic viewport minus that space', () => {
    const panel = rule('.dialog--menu-actions')
    // Fallback first, so browsers without dvh keep a cap.
    const fallback = panel.indexOf('max-height: 100%;')
    const dynamic = panel.search(/max-height:\s*min\(100%,\s*calc\(100dvh - var\(--dialog-space-top\) - var\(--dialog-space-bottom\)\)\)/)
    expect(fallback).toBeGreaterThanOrEqual(0)
    expect(dynamic).toBeGreaterThan(fallback)
    expect(panel).toMatch(/overflow:\s*hidden/)
    // The whole panel must not scroll (that would take the header with it).
    expect(panel).not.toMatch(/overflow-y:\s*auto/)
  })

  it('keeps the header fixed and scrolls only the action region', () => {
    expect(rule('.dialog--menu-actions .card-header')).toMatch(/flex:\s*none/)
    expect(rule('.card-header')).not.toMatch(/overflow/)
    const actions = rule('.card-menu__actions')
    expect(actions).toMatch(/min-height:\s*0/)
    expect(actions).toMatch(/flex:\s*0 1 auto/)
    expect(actions).toMatch(/overflow-y:\s*auto/)
    expect(actions).toMatch(/overscroll-behavior:\s*contain/)
    // The list itself keeps its height (and border); the region scrolls instead.
    expect(rule('.card-menu__actions .menu-list')).toMatch(/flex:\s*none/)
  })

  it('keeps list focus rings inset so the scroll region cannot clip them', () => {
    expect(rule('.menu-list__item:focus-visible')).toMatch(/outline-offset:\s*-3px/)
    // Standalone rule (the first match is the shared hover/focus background rule).
    expect(css).toMatch(/\n\.card-header__close:focus-visible\s*\{[^}]*outline-offset:\s*-3px/)
  })
})

describe('checkout card bands (v0.6.1)', () => {
  it('has a tall upper band in the card color holding the title, and a 0.75rem lower band', () => {
    expect(rule('.checkout')).toMatch(/--checkout-band-top:\s*3\.5rem/)
    expect(rule('.checkout')).toMatch(/--checkout-band-bottom:\s*0\.75rem/)
    const top = rule('.checkout__band--top')
    expect(top).toMatch(/height:\s*var\(--checkout-band-top\)/)
    expect(top).toMatch(/color:\s*var\(--card-on-accent/)
    expect(rule('.checkout__band--bottom')).toMatch(/height:\s*var\(--checkout-band-bottom\)/)
    // Long titles are clamped inside the band rather than growing it.
    expect(rule('.checkout__store')).toMatch(/line-clamp:\s*2/)
  })

  it('leaves the optical-code area white and undistorted', () => {
    expect(rule('.checkout__face')).toMatch(/background:\s*#ffffff/)
    const image = rule('.checkout__code .barcode__image')
    expect(image).toMatch(/width:\s*100%/)
    expect(image).toMatch(/height:\s*100%/)
    expect(css).toMatch(/\.barcode__image\s*\{[^}]*object-fit:\s*contain/)
  })
})

/*
 * Picker grids (v0.6.1 final palette expansion): both pickers use exactly
 * five columns, so fifteen colours form three complete rows and None plus
 * nine categories form two. minmax(0, 1fr) lets columns shrink on narrow
 * phones; the swatch keeps its own touch-target minimum and size cap.
 */
describe('five-column pickers (v0.6.1 final palette expansion)', () => {
  it.each(['.color-picker__swatches', '.icon-picker__options'])('%s is a fixed five-column grid with the existing gap', (selector) => {
    expect(normalized(selector)).toBe('display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: var(--space-2)')
  })

  it('lets picker labels use half a gap on each side, never more (no overlap with neighbours)', () => {
    for (const selector of ['.color-picker__label', '.icon-picker__label']) {
      expect(rule(selector), selector).toMatch(/max-width:\s*calc\(100% \+ var\(--space-2\)\);/)
    }
    // The option centres its label, so the overflow is split evenly across both gaps.
    for (const selector of ['.color-picker__option', '.icon-picker__option']) expect(rule(selector)).toMatch(/align-items:\s*center;/)
    expect(rule('.color-picker__label')).toMatch(/overflow-wrap:\s*break-word;/)
  })

  it('keeps the swatch touch-target minimum and size cap', () => {
    for (const selector of ['.color-picker__swatch', '.icon-picker__swatch']) {
      expect(rule(selector), selector).toMatch(/min-height:\s*var\(--touch-target\);/)
      expect(rule(selector), selector).toMatch(/max-width:\s*3\.5rem;/)
      expect(rule(selector), selector).toMatch(/aspect-ratio:\s*1;/)
    }
  })
})

/*
 * Flat card surfaces (v0.6.1 gradient finding). The wallet tile, the
 * card-menu identity header and the checkout bands show the exact palette
 * colour with no sheen gradient, gloss, texture, filter or blend overlay.
 * Every rule whose selector targets one of these surfaces (including state
 * variants and pseudo-elements) is checked, so an overlay cannot return via
 * a ::before/::after layer either.
 */
describe('flat card surfaces (v0.6.1 gradient finding)', () => {
  const SURFACE = /\.(tile|tile__open|tile--[\w-]+|card-header|checkout__band|checkout__band--top|checkout__band--bottom)(?![\w-])/
  const OVERLAY = /gradient|background-image|url\(|filter|mix-blend-mode|background-blend-mode|mask|text-shadow|animation/
  const uncommented = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const surfaceRules = Array.from(uncommented.matchAll(/([^{}]+)\{([^{}]*)\}/g), (m) => [m[1]!.trim(), m[2]!] as const).filter(([selector]) =>
    SURFACE.test(selector),
  )

  it('finds the rules for all three surfaces', () => {
    const selectors = surfaceRules.map(([selector]) => selector)
    for (const expected of ['.tile', '.tile__open', '.card-header', '.checkout__band', '.checkout__band--top']) {
      expect(selectors, expected).toContain(expected)
    }
  })

  it('has no gradient, image, texture, filter or blend layer on any card surface rule', () => {
    for (const [selector, body] of surfaceRules) expect(body, selector).not.toMatch(OVERLAY)
  })

  it('leaves the tile button transparent so the inline palette colour shows unaltered', () => {
    expect(rule('.tile__open')).toMatch(/background:\s*transparent;/)
  })

  it('paints the checkout bands with the palette colour only', () => {
    expect(normalized('.checkout__band')).toBe('flex: none; background: var(--card-accent, #455a64)')
  })

  it('has no card-surface pseudo-element overlay other than the drag drop-slot outline', () => {
    const pseudo = surfaceRules.map(([selector]) => selector).filter((selector) => /::?(before|after)/.test(selector))
    expect(pseudo).toEqual(['.tile--dragging::before'])
  })

  it('keeps the existing white sheen gradient out of the whole stylesheet', () => {
    expect(css).not.toMatch(/linear-gradient\(160deg/)
  })
})
