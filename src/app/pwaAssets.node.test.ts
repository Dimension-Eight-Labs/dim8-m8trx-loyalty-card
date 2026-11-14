/**
 * PWA identity checks (v0.5.0): manifest names and colours, icon files and
 * their real pixel sizes, index.html metadata, the version constant, and the
 * logo assets. Host test reading repository files; it does not prove how
 * iOS renders the installed icon (that is a physical-iPhone check).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { APP_NAME, APP_VERSION } from './appMetadata.ts'
import { BACKGROUND_COLOR, PWA_MANIFEST, THEME_COLOR } from './pwaManifest.ts'

const ROOT = join(import.meta.dirname, '../..')
const read = (path: string) => readFileSync(join(ROOT, path))

/** Width and height from a PNG's IHDR chunk. */
function pngSize(path: string) {
  const bytes = read(path)
  expect(bytes.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

describe('PWA manifest and browser metadata', () => {
  it('names the app M8TRX with DIM8 attribution and the DIM8 background colours', () => {
    expect(PWA_MANIFEST.name).toBe('M8TRX')
    expect(PWA_MANIFEST.short_name).toBe('M8TRX')
    expect(PWA_MANIFEST.description).toContain('by DIM8 Labs')
    expect(PWA_MANIFEST.display).toBe('standalone')
    expect(PWA_MANIFEST.start_url).toBe('/')
    const tokens = read('src/styles/tokens.css').toString()
    const bg = /--dim8-bg:\s*(#[0-9a-f]{6})/i.exec(tokens)?.[1]
    expect(THEME_COLOR.toLowerCase()).toBe(bg)
    expect(BACKGROUND_COLOR.toLowerCase()).toBe(bg)
    expect(PWA_MANIFEST.theme_color).toBe(THEME_COLOR)
    expect(PWA_MANIFEST.background_color).toBe(BACKGROUND_COLOR)
  })

  it('references icon files that exist at their declared sizes, including a maskable icon', () => {
    for (const icon of PWA_MANIFEST.icons) {
      const [w, h] = icon.sizes.split('x').map(Number)
      expect(pngSize(`public/${icon.src}`)).toEqual({ width: w, height: h })
    }
    expect(PWA_MANIFEST.icons.map((icon) => icon.purpose)).toEqual(['any', 'any', 'maskable'])
    expect(pngSize('public/apple-touch-icon.png')).toEqual({ width: 180, height: 180 })
    expect(read('public/favicon.svg').toString()).toMatch(/^<svg[^>]+viewBox="0 0 100 100"/)
  })

  it('uses M8TRX in index.html and links the favicon and Apple touch icon', () => {
    const html = read('index.html').toString()
    expect(html).toContain('<title>M8TRX</title>')
    expect(html).toContain('<meta name="apple-mobile-web-app-title" content="M8TRX" />')
    expect(html).toContain('by DIM8 Labs')
    expect(html).toContain(`<meta name="theme-color" content="${THEME_COLOR}" />`)
    expect(html).toContain('<link rel="icon" href="/favicon.svg" type="image/svg+xml" />')
    expect(html).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png" />')
    expect(html).not.toMatch(/Loyalty Card/)
  })

  it('precaches the bundled logo for offline use and keeps the public icons', () => {
    const config = read('vite.config.ts').toString()
    expect(config).toContain("'assets/**/*.{png,webp}'")
    expect(config).toContain("includeAssets: ['favicon.svg', 'apple-touch-icon.png']")
  })
})

describe('app metadata', () => {
  it('derives the version from package.json', () => {
    const pkg = JSON.parse(read('package.json').toString()) as { version: string }
    expect(APP_VERSION).toBe(pkg.version)
    expect(APP_NAME).toBe('M8TRX')
  })

  it('ships logo derivatives with the official artwork proportions', () => {
    const source = pngSize('assets/brand/dim8-vfd-logo.png')
    expect(source).toEqual({ width: 1254, height: 1254 })
    const small = pngSize('src/assets/brand/dim8-logo-120.png')
    const large = pngSize('src/assets/brand/dim8-logo-240.png')
    expect(small.height).toBe(120)
    expect(large.height).toBe(240)
    // Same trimmed aspect ratio at both sizes (within rounding).
    expect(Math.abs(small.width / small.height - large.width / large.height)).toBeLessThan(0.01)
  })
})
