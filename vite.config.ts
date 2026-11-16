/**
 * Vite build, PWA, and test configuration.
 *
 * PWA strategy (vite-plugin-pwa / Workbox `generateSW`):
 * - The production build emits `manifest.webmanifest` and a service worker that
 *   precaches the complete application shell (HTML, JS, CSS, icons). After one
 *   successful online visit, the app loads and reloads fully offline.
 * - Navigations fall back to the precached `index.html`, so the single-page shell
 *   is served offline regardless of the requested path.
 * - No runtime caching is configured: the app loads nothing from external hosts,
 *   and there is no backend. Add runtime routes only when a feature needs them.
 * - `autoUpdate` activates a new service worker as soon as it is installed.
 *   Saved cards live in IndexedDB, which a service-worker update never
 *   touches. The only exposure is an unsaved form if an update reloads the
 *   page mid-edit; that is accepted for now (forms are short) and kept
 *   unchanged to preserve the existing PWA behaviour. A "reload to update"
 *   prompt remains a possible future refinement.
 * - The service worker is disabled in `npm run dev`; verify offline behaviour
 *   with `npm run build && npm run preview`.
 * - Images imported by application code (the DIM8 logo) are emitted under
 *   dist/assets/ with hashed names and precached by the `assets/**` pattern
 *   below, so branding still renders offline.
 *
 * Deployment base path (GitHub Pages):
 * - Production-mode runs (`npm run build` and `npm run preview`) use
 *   GITHUB_PAGES_BASE (`/dim8-m8trx-loyalty-card/`) as Vite's `base`. Script,
 *   CSS, icon, manifest and service-worker URLs are all emitted under it, and
 *   vite-plugin-pwa registers `sw.js` with that path as its scope, so the
 *   service worker controls only this app's subpath of the github.io origin.
 * - The decision keys on `mode`, not `command`: `vite preview` resolves the
 *   config with command `serve`, yet it must serve the build at the same
 *   subpath the build was made for. Preview therefore opens at
 *   http://localhost:4173/dim8-m8trx-loyalty-card/.
 * - Development (`npm run dev`) and Vitest keep base `/`, so the dev server
 *   URL is unchanged.
 * - The app has no URL routes (navigation is in-memory state), so GitHub
 *   Pages needs no 404.html fallback; reloads always request the base URL.
 *
 * Manifest data (names, colours, icons) lives in src/app/pwaManifest.ts so a
 * host test can verify it; `__APP_VERSION__` exposes package.json's version
 * to the app (see src/app/appMetadata.ts).
 */
import { readFileSync } from 'node:fs'
import { configDefaults, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { createPwaManifest, GITHUB_PAGES_BASE } from './src/app/pwaManifest.ts'

const packageJson = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as { version: string }

export default defineConfig(({ mode }) => {
  const base = mode === 'production' ? GITHUB_PAGES_BASE : '/'
  const manifest = createPwaManifest(base)

  return {
    base,
    define: {
      __APP_VERSION__: JSON.stringify(packageJson.version),
    },
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        // Registers the service worker via a small deferred script in index.html,
        // keeping registration out of application code.
        injectRegister: 'script-defer',
        // Static files precached in addition to the build output. Manifest icons
        // and the manifest itself are added automatically by the plugin.
        includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
        manifest: { ...manifest, icons: manifest.icons.map((icon) => ({ ...icon })) },
        workbox: {
          // Build output only; public/ assets come from includeAssets and the
          // manifest icons, which avoids duplicate precache entries.
          // dist/assets/ holds only Vite-emitted files, so adding its images
          // (the bundled DIM8 logo) does not duplicate the public/ icons.
          globPatterns: ['**/*.{js,css,html}', 'assets/**/*.{png,webp}'],
          // Relative to the service worker, i.e. <base>index.html.
          navigateFallback: 'index.html',
          cleanupOutdatedCaches: true,
        },
      }),
    ],
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test/setup.ts'],
      css: false,
      // tests/ holds the Playwright rendered-layout specs (npm run test:layout),
      // which need a real browser and must not run under jsdom.
      exclude: [...configDefaults.exclude, 'tests/**'],
    },
  }
})
