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

/** The declarations of the first rule whose selector is exactly `selector`. */
function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(css)
  expect(match, `rule for ${selector}`).not.toBeNull()
  return match![1]!
}

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
