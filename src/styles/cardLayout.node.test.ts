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
