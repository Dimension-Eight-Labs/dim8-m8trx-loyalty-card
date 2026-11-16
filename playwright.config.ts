/**
 * Playwright configuration for rendered-layout regression tests
 * (`npm run test:layout`, tests/*.spec.ts).
 *
 * Why a real browser: jsdom does not lay out CSS, so the Vitest suite can only
 * check stylesheet declarations. The picker regression fixed in v0.6.1
 * (non-square swatches and a truncated "Hardware" label at 320px) was only
 * visible in rendered geometry, so these tests measure getBoundingClientRect()
 * in Chromium at phone widths.
 *
 * The tests run against the production build served by `vite preview`, i.e.
 * under the GitHub Pages base path (/dim8-m8trx-loyalty-card/), so they
 * exercise the same CSS bundle that is deployed. The service worker is blocked
 * so every test starts from a clean, uncached page.
 *
 * Browser: Playwright's bundled Chromium (`npx playwright install chromium`).
 * Set PLAYWRIGHT_CHROMIUM_EXECUTABLE to use an already installed
 * Chromium-based browser instead (for example /usr/bin/brave-browser).
 *
 * Limitation: Chromium layout with the host's fonts is not Mobile Safari or
 * Samsung Internet with their system fonts. Physical-device checks remain a
 * separate manual step (see README).
 */
import { defineConfig } from '@playwright/test'

/** Distinct from the default preview port (4173) so a running preview is not reused by accident. */
const PORT = 4174
const BASE_URL = `http://localhost:${PORT}/dim8-m8trx-loyalty-card/`
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined

export default defineConfig({
  testDir: 'tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: 'list',
  use: {
    baseURL: BASE_URL,
    browserName: 'chromium',
    serviceWorkers: 'block',
    // Phone-like context: mobile viewport semantics (overlay scrollbars, meta
    // viewport honoured) and a high-density screen so subpixel rounding
    // resembles a phone. Each spec sets its own viewport width.
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 3,
    launchOptions: executablePath ? { executablePath } : {},
  },
  webServer: {
    command: `npm run build && npm run preview -- --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 180_000,
  },
})
