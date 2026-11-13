# DIM8 Loyalty Card

A minimalist, mobile-first, installable Progressive Web App (PWA) for storing
and displaying loyalty and membership cards.

The product does one job on purpose. It has **no accounts, advertisements,
analytics, cloud backend, or synchronization**, and it loads nothing from
third-party hosts.

## Current status (v0.1.0 foundation)

This milestone is only the application foundation:

- React + TypeScript + Vite project.
- Installable PWA with an offline-capable application shell.
- Responsive home screen with an empty state and an **Add Card** button.
- Component tests, linting, and type checking.

Not implemented yet: the card entry workflow, card storage, barcode scanning,
and card display. Activating **Add Card** only announces "Adding cards isn’t
available yet." It does not pretend to save anything.

## Prerequisites

- Node.js `^22.22.2`, `^24.15.0`, or `>=26` (see `.nvmrc`; the lower bounds
  come from jsdom/Vitest).
- npm (the lockfile is `package-lock.json`).

## Commands

| Command             | Purpose                                                        |
| ------------------- | -------------------------------------------------------------- |
| `npm install`       | Install dependencies.                                          |
| `npm run dev`       | Start the dev server (service worker disabled).                |
| `npm test`          | Run the component tests once (Vitest + Testing Library).       |
| `npm run test:watch`| Run the tests in watch mode.                                   |
| `npm run lint`      | Run ESLint.                                                    |
| `npm run typecheck` | Type-check the app and config with `tsc -b`.                   |
| `npm run build`     | Type-check, then build to `dist/` with the manifest and service worker. |
| `npm run preview`   | Serve the production build locally.                            |
| `npm run icons`     | Regenerate the icons in `public/` from `scripts/generate-icons.mjs`. |

## Project structure

```
index.html                  HTML shell: viewport, theme colour, favicon
vite.config.ts              Vite, PWA (manifest + service worker), and Vitest config
scripts/generate-icons.mjs  Reproducible icon generator (Node built-ins only)
public/                     Generated icons (committed outputs of `npm run icons`)
src/
  main.tsx                  Entry point: global styles, mounts <App />
  app/App.tsx               Composition root: layout, wires features together
  components/               Shared presentation components (AppHeader)
  features/cards/           Card feature UI (CardEmptyState)
  styles/
    tokens.css              Design tokens: colour, spacing, type, touch-target size
    base.css                Reset and document defaults, focus ring
    app.css                 Layout and component styles
  test/setup.ts             Shared test setup (jest-dom matchers, cleanup)
```

Responsibilities:

- **`App`** owns layout and decides what happens when Add Card is activated.
  It has no router, global state, or persistence. Those come with the features
  that need them.
- **`CardEmptyState`** is presentation only. It receives an `onAddCard`
  callback, so the future card-entry workflow can be connected without
  changing the component or coupling it to storage.
- **`AppHeader`** is a static product header.

Tests sit next to the code they cover (`*.test.tsx`).

## PWA and offline behaviour

`vite-plugin-pwa` (Workbox `generateSW`) produces `dist/manifest.webmanifest`,
`dist/sw.js`, and a small `registerSW.js` that `index.html` loads.

- The service worker precaches the whole shell: HTML, JS, CSS, the manifest,
  and the icons. After one successful online visit, the app loads offline.
- All navigations fall back to the precached `index.html`.
- There is no runtime caching, because the app requests nothing from other hosts.
- Updates install and activate automatically (`registerType: 'autoUpdate'`).
  This is safe while the app holds no user data. Revisit it once card editing
  exists.
- The service worker is disabled in `npm run dev`.

### Verifying offline support manually

1. `npm run build && npm run preview`, then open the printed URL in Chrome or Edge.
2. In DevTools → **Application** → **Service workers**, confirm `sw.js` is
   activated. Under **Manifest**, confirm the name, icons, and installability.
3. Reload once so the page is controlled by the service worker.
4. In DevTools → **Network**, choose **Offline** and reload. The home screen
   should still appear.

On a phone, use the browser's "Install app" / "Add to Home Screen" action. PWA
installation requires HTTPS, except on `localhost`.

## Icons

The icons are placeholder artwork: a stylised card on the accent colour. They
are generated from the geometry and colours in `scripts/generate-icons.mjs`.
Do not edit the PNGs by hand. Change the script and run `npm run icons`.
Replace the artwork if authoritative DIM8 brand assets become available.

The accent and background colours appear in three places. Keep them in sync:
`src/styles/tokens.css`, `vite.config.ts`, and `index.html`.
