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
 * - `autoUpdate` activates a new service worker as soon as it is installed. The
 *   app holds no in-progress user data yet, so a silent update is safe. Revisit
 *   this (e.g. a "reload to update" prompt) once card editing exists.
 * - The service worker is disabled in `npm run dev`; verify offline behaviour
 *   with `npm run build && npm run preview`.
 */
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Single source for the colours shared by the manifest and index.html.
// Keep in sync with --color-bg / --color-accent in src/styles/tokens.css.
const THEME_COLOR = '#1f4fd8'
const BACKGROUND_COLOR = '#f6f6f3'

export default defineConfig({
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
      manifest: {
        id: '/',
        name: 'DIM8 Loyalty Card',
        short_name: 'Loyalty Card',
        description: 'Store and display your loyalty and membership cards.',
        lang: 'en',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: THEME_COLOR,
        background_color: BACKGROUND_COLOR,
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: 'maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Build output only; public/ assets come from includeAssets and the
        // manifest icons, which avoids duplicate precache entries.
        globPatterns: ['**/*.{js,css,html}'],
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
  },
})
