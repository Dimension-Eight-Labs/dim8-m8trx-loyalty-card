# DIM8 Loyalty Card

A minimalist, mobile-first, installable Progressive Web App (PWA) for storing
and displaying loyalty and membership cards.

The product does one job on purpose. It has **no accounts, advertisements,
analytics, cloud backend, or synchronization**, and it loads nothing from
third-party hosts.

## Current status (v0.4.2 card wallet, development)

Capture a physical loyalty card once, then show a clean, freshly drawn barcode
at checkout.

- **Wallet home screen**: a grid of square, coloured tiles showing the store
  name and a miniature card preview (a decorative bar, QR-style or grid motif
  for the barcode type, or the saved artwork for image cards). The motif never
  encodes the card's value; no number is shown. Tap a tile to open the card.
  **Press and hold** a tile (touch) or **drag** it (mouse/pen) to rearrange
  the wallet; the order is saved on the device. A tile's small **⋯** button
  opens **Rename**, **Change colour**, **Move earlier / later / to first /
  to last** (the keyboard-accessible way to reorder), and **Delete** (with
  confirmation). A small **+** in the top corner adds a card.
- **Checkout mode**: an **M8TRX** title at the top, then the store name
  (in the DIM8 VFD colour) immediately above the card, which floats as a
  centred white tile (thin bands in the card's colour, barcode scaled to
  fit) on a dark stage with the subtle M8TRX circuit backdrop. Linear codes
  use a compact credit-card face; QR codes (redrawn or saved artwork) use a
  larger near-square face. Pagination chevrons and dots are at the bottom; a
  small **×** is in the top corner. Close with the **×**, Escape, or a deliberate swipe
  down. Swipe left/right (or use ←/→ or the small chevrons) to move between
  cards; navigation stops at the first/last card. Page scrolling is locked, and the
  screen is kept awake where the browser supports it.
- **Adding a card** — three ways:
  - **Scan card**: live rear-camera viewfinder; decodes in the browser.
  - **Import image**: a screenshot or photo from Photos/Files. If no barcode
    is found automatically, crop and zoom (Wide or Square frame) and try
    again; if it still can't be read, save the **cropped image** instead.
    When a QR code is found, choose **Use redrawn QR code** (default) or
    **Keep original artwork** (crop and save the code's own design, e.g. a
    logo QR; the decoded value is kept alongside).
  - **Enter manually**: type the exact value and pick the format; it is
    validated (including check digits) and previewed before continuing.

  Then check the redrawn barcode (format and exact value are shown), enter the
  store name, pick a tile colour, and save.
- Cards are stored on the device in IndexedDB. Existing v0.2.0 cards are
  migrated automatically and are never deleted.
- Dark interface in the official DIM8 Labs palette, keyboard accessible; no accounts, backend, analytics, or
  third-party requests.

### v0.4.2 — QR sizing, checkout layout and DIM8 palette (Iteration 4E)

Development version; not published or deployed.

- **Card shape follows the barcode** (`barcodes/presentation.ts`, exposed as
  `data-presentation` on the card face):
  - `square` — QR, Data Matrix and Aztec, both redrawn and **saved custom
    artwork** whose detected format is one of these. A near-square face
    (0.93, up to 20 rem wide) gives the symbol roughly 50% more height than
    v0.4.1 on common phones (about 230 px wide code area at 320 px, 290 px at
    375 px, CSS-derived; checked in headless Firefox, not measured on a
    phone). Artwork keeps its aspect ratio (letterboxed on white, never
    stretched, cropped or recoloured).
  - `stacked` — PDF417 keeps the slightly taller v0.4.1 face. It is never
    treated as QR.
  - `card` — linear codes, imported images with an unknown or non-square
    detected format, and text-only cards keep the compact credit-card face.
  The shape is decided from the stored/detected format only, never from an
  image's pixel shape.
- **Store name immediately above the card** (it moves with the card while
  dragging), in the app font and DIM8 VFD colour. Long names wrap to two
  lines (one in short landscape) and are then clamped visually; the dialog's
  accessible name is always the complete name. The pagination stays at the
  bottom.
- **M8TRX header** centred at the top, balanced against the × by an equal
  spacer. It uses the `--font-segment` token, a hook for the official DIM8
  seven-segment font (not yet supplied; falls back to the DIM8 wordmark stack
  `"Avenir Next", "Segoe UI", Helvetica, Arial, sans-serif`). It is
  decorative (`aria-hidden`); screen readers still hear the card name.
- **Official DIM8 Labs palette** applied app-wide through `tokens.css`: raw
  `--dim8-*` values from the DIM8 website stylesheets (background `#010100`,
  surfaces `#0A0C0D` / `#111517`, text `#ECEEEC` / `#C9CFCD` / `#96A3A0`,
  border `#1C2426`, VFD `#B8DDD7` / `#D6F4EF` / `#5D837E` / `#97B5B0`, glow
  `rgb(140 220 206 / 38%)`) mapped onto the existing semantic `--color-*`
  tokens. The body font is the DIM8 body stack. The circuit backdrop keeps
  its geometry and opacities but is drawn in the VFD colour; browser/PWA
  theme colours follow the new background. Loyalty-card colours, card
  artwork and barcodes are unchanged.
- The DIM8 logo, seven-segment font and app icons are deferred to the final
  branding pass (the icons still use the original placeholder artwork).
- No IndexedDB schema change; no new dependencies.

Checked in headless desktop Firefox at 320×568, 375×667, 390×844 and
667×375 (QR, imported QR artwork, PDF417, Code 128, long names, wallet
backdrop). **Not yet checked on an iPhone or with a checkout scanner** (see
the v0.4.2 checklist below).

### v0.4.1 — Checkout stage redesign

Development version; not published or deployed.

Instead of continuing to match the iPhone safe-area colour to the active
card, checkout no longer fills the screen with the accent colour at all:

- The outer surface is always the dark app background plus a shared, subtle
  M8TRX backdrop (faint circuit traces, matrix grid and glow, drawn in CSS
  from a local inline SVG; no remote assets). The wallet uses the same
  backdrop. `<html>`/`<body>` stay dark while checkout is open, and the
  v0.4.0 `--checkout-accent` / `--checkout-on-accent` root properties have
  been removed.
- The card is a centred white tile — credit-card ratio for linear codes,
  slightly taller for square 2D codes so QR / Data Matrix / Aztec stay
  large enough to scan — capped at 22 rem wide and sized to the space left
  in short landscape views. Its accent colour appears only in its thin top
  and bottom bands. Codes are scaled to fit inside the card (never
  stretched; the quiet zone is part of the image). Text-only cards size the
  card to their content.
- The store name moved from the header band to the dark background near the
  bottom, in the app font and the brand colour (`--color-brand`, which
  currently equals the existing accent `#8ab4f8`: no authoritative DIM8 VFD
  colour is defined in this repository), directly above the chevrons and
  dots. Long names truncate to one line.
- Close (×, Escape, swipe down), swipe/arrow/chevron navigation, wake lock
  and focus behaviour are unchanged.
- Wallet tiles keep their size and layout; the miniature card preview is now
  centred horizontally and vertically in the tile. When a long store name
  wraps to two lines, the preview moves up only as far as needed so the two
  never overlap.

Checked in headless desktop Firefox at 320×568, 375×667, 390×844 and
844×390 (linear, QR, PDF417, EAN-13, text-only, single- and multi-card,
long names). **Not yet checked on an iPhone or with a checkout scanner**
(see the v0.4.1 checklist below).

### v0.4.0 — Card order and checkout safe-area colour (Iteration 4C)

Development version; not published or deployed.

**Safe-area colour fix.** On a physical iPhone (Brave, HTTPS) the area
around the camera cutout kept the first card's accent colour after swiping
to a differently coloured card, although the header updated. The header and
bottom strip already followed the active card, but the document canvas
(`<html>`/`<body>`) never did, and iOS can paint the notch and
home-indicator areas from that canvas. Checkout now publishes the active
card's colours on `<html>` as `--checkout-accent` / `--checkout-on-accent`
(rewritten before paint on every card switch, removed on close), paints the
canvas with them while open, and the header and bottom strip read the same
value. Text contrast still comes from the palette pairs (all ≥ 4.5:1). Host
tests cover the colour values through repeated swipes and cleanup on close;
**actual notch painting must still be confirmed on an iPhone** (checklist
below).

**User-defined card order.**

- *Touch*: press and hold a tile for 500 ms without moving, then drag.
  Moving more than 10 px before that counts as scrolling and nothing is
  dragged. Once a drag starts, the page stops scrolling under the finger and
  auto-scrolls near the top/bottom edge.
- *Mouse/pen*: press and move at least 6 px; a press without movement is an
  ordinary click.
- The dragged tile lifts and follows the pointer; a dashed outline marks
  where it will land, and the other tiles slide aside (no slide under
  reduced motion). Release saves; Escape or a cancelled pointer reverts. A
  drag never opens the card, and long-press no longer opens the management
  menu — the **⋯** button is its only entry point.
- *Keyboard / screen readers*: **⋯** → **Move earlier**, **Move later**,
  **Move to first**, **Move to last** ("earlier/later" follow reading order,
  whatever the column count; unavailable moves are disabled). Focus returns
  to the moved card and its new position is announced.
- New cards are added at the end; renaming or recolouring never moves a
  card. The saved order is also checkout's left/right order.
- The order is stored in IndexedDB (see *Data model*). If saving fails the
  previous order stays and a message is shown.

### v0.3.2 — QR image-import fix and wallet refinements (Iteration 4B)

**QR image import.** After v0.3.1, imported QR screenshots stopped decoding
for the user. The customer screenshots are not in the repository, so their
exact failure is **still unverified**; the cause below was reproduced on host
with sanitized, real PNG fixtures (`src/test/fixtures/qr`, generated by
`scripts/generate-qr-fixtures.py`).

Root cause (host-reproduced): v0.3.1 began decoding imports at native
resolution (up to 3000 px, previously the browser resampled to ≤2000 px).
ZXing's QR finder fails at native resolution on two common kinds of image —
a small QR bitmap that an app or web page enlarged with smoothing (soft
module edges), and noisy or JPEG-compressed photos — even with only QR
enabled. The v0.3.1 cascade then reached a QR-friendly view only after
several full-resolution steps that each ran all ~15 ZXing readers with "try
harder" (up to ~0.9 s each on a desktop, ~3.5 s total for a noisy photo), and
only ½ and ¼ scales were offered. On a phone that can approach or exceed the
8 s budget. No single scale works for every image (a logo QR that reads
natively fails at ½), so changing the resolution alone would trade one
failure for another.

Fix (still-image path only; live camera scanning code is unchanged):

- Step 1 still decodes the **unmodified original** with every format.
- Then a cheap **QR sweep** (QR-only decodes: native global threshold, ½, ⅓,
  ¼, ⅙ box downscales, thresholded ½ and ⅓, inverted ½) runs before the
  existing all-format fallbacks. Views only downscale, threshold, invert, or
  rotate the whole image — never crop — so finder patterns and the quiet
  zone are intact.
- **Weak reads** (detect-only formats, or Code 39, which has no mandatory
  check character) no longer end the cascade immediately: the QR sweep still
  runs and a QR read wins; otherwise the weak read is returned unchanged.
- The decode canvas no longer paints a white `fillRect` underlay before
  `drawImage`; `rgbaToGrey` already composites transparency onto white. The
  import path now reads pixels exactly as the working camera path does.
  Script-drawn canvas content is what fingerprinting protections (such as
  Safari's Advanced Fingerprinting Protection) may perturb on readback;
  whether this affected iPhone imports is **unverified**.

Evidence: all 13 QR fixtures (clean, tight quiet zone, dark app chrome, logo,
dot and rounded "artwork", exact whitespace/leading zeros, dark mode,
transparent background, JPEG, smooth-upscaled, noisy photo) decode to the
exact value in host tests; the three that fail at native resolution decode in
the QR sweep at step 2. The same fixtures also decode through the real
`loadImage` → canvas → cascade path in **WebKitGTK** (a desktop WebKit
browser, not iPhone Safari).

**Wallet and checkout.** Tiles show a miniature card preview; checkout shows
accent bands and a larger store name; swipe down closes checkout. Gesture
rules (`src/features/checkout/gesture.ts`): nothing happens within a 12 px
dead zone; the gesture then locks to its dominant axis; a horizontal release
≥ 60 px switches cards (unchanged); a vertical release ≥ 110 px downward and
at least 1.5× its sideways travel closes. Short, diagonal, upward and
browser-cancelled gestures do nothing, and a horizontal gesture can never
close.

### v0.3.1 — scanning fixes (Iteration 4A)

Fixes live scanning that showed the barcode clearly but never detected it,
and screenshots that did not decode automatically.

Root causes found (host-verified with real ZXing on synthetic images):

1. **ZXing Code 128 defect.** `@zxing/library` 0.23.0's
   `Code128Reader.findStartPattern` shrinks its 6-slot window to 4 slots
   (`counters.slice(2)`) after the first mismatch, so Code 128 only decoded
   when nothing dark preceded the barcode on the scanned row. Clean test
   images passed; camera frames (card edge, hand, table, printed text) and
   many screenshots did not. `src/features/barcodes/zxingPatches.ts` installs a
   faithful port of the Java original; a regression test fails without it.
   Remove the patch once upstream fixes it and that test still passes.
2. **Single full-resolution pass per frame.** Full-resolution frames with
   sensor-like noise defeated ZXing's QR finder and 1D readers in host
   experiments, while a 2× box-filter downscale of the same frame decoded.
   ZXing also cannot rotate our luminance source, so vertical barcodes were
   never read. The scan loop now cycles bounded views per tick: guide region
   (downscaled and native), whole frame, 90° rotation, contrast stretch, and
   periodically every format with "try harder".
3. **Silent loop death.** Any exception while sampling a frame ended the old
   `setTimeout` chain with no message. Every tick now reschedules unless the
   scan is stopped, and failures are counted by category.
4. **Screenshots** were decoded once, after downscaling to 2000 px (iPhone
   screenshots are up to 2868 px tall). They now decode at native resolution
   (up to 3000 px) through a bounded cascade: original, half size, contrast
   stretch, 90° rotation, global threshold, inverted (dark mode), quarter
   size, rotated + contrast. The cascade stops at the first read or after 8 s;
   the source image is never modified. Crop retries use the same cascade.
   *Unverified for the specific UDF/Kroger screenshots*: no fixtures were
   available in the repository, so their exact failure cause is not confirmed.

Scanning behaviour:

- Formats are recognised automatically. Most frames try QR, Code 128,
  Code 39, UPC-A, EAN-13 (and EAN-8); every sixth tick tries all supported
  formats so PDF417, Data Matrix and Aztec are found too, and unsupported
  symbologies are explained instead of ignored.
- Code 39 (no mandatory check character) and detect-only formats need two
  identical reads before acceptance; other formats are accepted on one read.
- The camera stops as soon as a result is confirmed; the result is handled
  once, and late results after Back/Scan again are ignored.
- After 8 s without a detection the scanner keeps scanning but shows advice
  (distance 15–25 cm for close-focus limits, light/glare, orientation) and
  Scan again / Import image / Enter manually. If frames arrive blank, or a
  canvas readback probe shows altered pixels (possible with privacy features
  such as Brave Shields' fingerprinting protection; unverified on iOS), the
  message says so specifically.
- **Scan details** (shown when scanning stalls or fails) lists the actual
  frame size, the camera's reported settings, decoded area, frame/miss/error
  counts, last error category, timings, playback state, canvas-read status and
  whether the Code 128 fix is active. It never shows decoded values. Nothing
  is logged in production builds; development builds log only
  sizes/counts/step names via `console.debug`.

### Barcode formats

| Format      | Scan / import | Manual entry | Drawn as SVG | Notes |
| ----------- | :-----------: | :----------: | :----------: | ----- |
| Code 128    | ✓ | ✓ | ✓ | ASCII only. Default for manual entry. |
| Code 39     | ✓ | ✓ | ✓ | Digits, capitals, space, `- . $ / + %` (no extended mode). |
| EAN-13      | ✓ | ✓ | ✓ | 13 digits, check digit verified. |
| UPC-A       | ✓ | ✓ | ✓ | 12 digits, check digit verified. |
| EAN-8       | ✓ | ✓ | ✓ | 8 digits, check digit verified. |
| QR code     | ✓ | ✓ | ✓ | |
| PDF417      | ✓ | ✓ | ✓ | |
| Data Matrix | ✓ | ✓ | ✓ | |
| Aztec       | ✓ | ✓ | ✓ | |
| Codabar, Code 93, ITF, UPC-E, GS1 DataBar, MaxiCode | detected only | — | — | Explained, then saved as a cropped image (import only). |

Decoding uses [ZXing](https://github.com/zxing-js/library) (`@zxing/library`,
pure JavaScript); drawing uses [bwip-js](https://github.com/metafloor/bwip-js).
Both run locally and are precached for offline use.

Exactness rules:

- Values are strings and are stored **exactly** as decoded or typed — never
  trimmed, padded, or case-changed. Leading zeros are preserved.
- The decoded symbology is kept; the app never substitutes another format.
- Before a barcode can be saved, the app redraws it, rasterizes the drawing in
  memory, and decodes it again; it must read back as the same value in the
  same format. **This proves the drawing encodes the value; it does not prove
  that a given checkout scanner will read it from a phone screen.**
- If a barcode can't be decoded or redrawn reliably, import offers a cropped
  image fallback rather than losing the card. Images and camera frames are
  processed on the device and never uploaded; camera frames are never stored.
- Quiet zones meet or exceed each symbology's minimum (10–12 modules for 1D,
  4 for QR) and are part of the drawn image.

Known decoder behaviour: a UPC-A barcode is physically an EAN-13 barcode that
starts with `0`. ZXing reports such codes as UPC-A (12 digits). The redrawn
bars are identical either way. GS1-128 (Code 128 with a leading FNC1) is read
as plain Code 128 and redrawn without the FNC1; use the image fallback if a
store requires GS1-128.

### Behaviour details and limitations

- **Duplicates are allowed.** Two cards may share a store or barcode.
- **Barcode data isn't editable.** To fix a wrong barcode, delete the card
  and add it again. Rename and colour can be changed at any time.
- **Order**: chosen by the user (drag or the ⋯ menu's move actions) and
  saved on the device; new cards go last; renaming or recolouring never
  reorders tiles.
- **Local only.** Cards exist only in this browser profile on this device.
  There is no backup, export, or sync. Clearing site data, uninstalling the
  PWA (on some platforms), or using a private window loses them.
- **No storage fallback.** If IndexedDB is unavailable or fails, the app says
  so and offers **Try again**.
- An automatic app update reloads the page; an unsaved add-card flow open at
  that moment is lost. Saved cards are unaffected.

### Browser and device limitations

- **Camera** needs a secure context (HTTPS or `localhost`) and permission. On
  denial or absence the app explains and offers Import or Manual entry.
  Torch and zoom controls are not offered (inconsistent support; absent on
  iOS Safari). Continuous autofocus is requested only where the track
  advertises it. Recent "Pro" iPhones cannot focus very close with the main
  camera; hold cards ~15–25 cm away. All iOS browsers (including Brave) use
  WebKit, so iPhone results apply across them, but browser privacy settings
  can still differ.
- **Decoding runs on the main thread** (no Web Worker yet). Each tick is
  bounded (a single view, followed by a pause as long as the tick, between
  120 and 400 ms), but very slow devices may feel less responsive while
  scanning.
- **Screen wake lock** uses the Screen Wake Lock API where available
  (Chromium, Safari 16.4+). It is best-effort: if unsupported or refused, the
  screen dims on its normal timer. iOS home-screen web apps reportedly ignored
  the lock before iOS 18.4 — unverified, check on a device.
- **Screen brightness** cannot be controlled by a web app on any platform,
  including iPhone. Turn brightness up manually if a scanner struggles.
- **Reordering** uses Pointer Events: touch needs a 500 ms hold with 10 px
  movement tolerance, mouse/pen a 6 px movement. After a touch drag starts,
  a non-passive `touchmove` listener stops page scrolling; whether WebKit
  honours this in every iOS browser must be confirmed on a device. The iOS
  callout and text selection are suppressed on tiles. The **⋯** menu's move
  actions are always available as an alternative.
- **Swipe** uses Pointer Events with `touch-action: none` on the card. In iOS
  Safari (not installed), the system edge-swipe "back" gesture may still win
  at the very edge of the screen.

### Data model and migration

Database `dim8-loyalty-card`, object store `cards` (keyed by `id`), plus
(from version 3) a small `meta` store.

- **Version 1** (v0.2.0): `{ id, storeName, cardNumber, notes, createdAt, updatedAt }`.
- **Version 2** (v0.3.0): `{ id, schemaVersion: 2, storeName, color, barcode,
  notes?, createdAt, updatedAt }` where `barcode` is one of
  - `{ kind: 'generated', format, value }` — drawn at checkout;
  - `{ kind: 'image', image: Blob, detectedFormat?, detectedValue? }` — cropped
    picture fallback;
  - `{ kind: 'text', value }` — a number without a known format.
- **Version 3** (v0.4.0): card records are unchanged; a new `meta` store
  holds `walletOrder`, an array of card IDs in the user's order. Keeping the
  order outside the card records means a reorder rewrites one small array
  (never card data or stored artwork), and rename/recolour cannot move a
  card. The 2 → 3 upgrade seeds `walletOrder` from the existing display
  order (oldest first), so nothing moves on upgrade. The order is read
  defensively: listed cards first, then any readable card missing from the
  list (oldest first); duplicate or stale IDs are ignored, and IDs of records
  this version can't read keep their place. A reorder must name every card
  exactly once or it is rejected without saving. Opening a version-3
  database with v0.3.x fails with "Couldn't open card storage" and leaves
  the data untouched.

The upgrade runs inside IndexedDB's version-change transaction, so it either
completes or leaves version 1 untouched. Each v0.2.0 card becomes a
`text` card with its number copied exactly, a varied tile colour, and its
notes kept (no longer shown). **No barcode format is guessed** for migrated
cards: checkout shows the number with a note suggesting re-adding the card by
scanning. Records the app doesn't recognize are left in place, never deleted.
Timestamps are kept internally but never shown.

## Prerequisites

- Node.js `^22.22.2`, `^24.15.0`, or `>=26` (see `.nvmrc`; the lower bounds
  come from jsdom/Vitest).
- npm (the lockfile is `package-lock.json`).

## Commands

| Command             | Purpose                                                        |
| ------------------- | -------------------------------------------------------------- |
| `npm install`       | Install dependencies.                                          |
| `npm run dev`       | Start the dev server (service worker disabled).                |
| `npm test`          | Run the unit, component, and persistence tests once (Vitest).  |
| `npm run test:watch`| Run the tests in watch mode.                                   |
| `npm run lint`      | Run ESLint.                                                    |
| `npm run typecheck` | Type-check the app and config with `tsc -b`.                   |
| `npm run build`     | Type-check, then build to `dist/` with the manifest and service worker. |
| `npm run preview`   | Serve the production build locally.                            |
| `npm run icons`     | Regenerate the icons in `public/` from `scripts/generate-icons.mjs`. |

## Project structure

```
index.html                  HTML shell: viewport, dark theme colour, favicon
vite.config.ts              Vite, PWA (manifest + service worker), and Vitest config
scripts/generate-icons.mjs  Reproducible icon generator (Node built-ins only)
public/                     Generated icons (committed outputs of `npm run icons`)
src/
  main.tsx                  Entry: global styles, IndexedDB repository, mounts <App>
  app/App.tsx               Composition root: screen state (wallet/add/checkout),
                            management dialogs, lazy-loads the add flow
  components/               Shared presentation (AppHeader, Dialog, ViewHeading, icons)
  data/
    indexedDbCardRepository.ts  IndexedDB implementation of CardRepository + upgrades
    cardRecords.ts              v1→v2 record migration and defensive record reading
  features/
    cards/                  Domain model (card.ts), tile palette, CardRepository
                            interface, useCards controller, ColorPicker,
                            DeleteCardDialog, CardEmptyState
    barcodes/               formats.ts (format registry), render.ts (bwip-js SVG),
                            presentation.ts (checkout card-face shape),
                            rasterize.ts (pure bitmap renderer), decode.ts (ZXing),
                            verify.ts (round-trip check), zxingPatches.ts
                            (Code 128 library fix), bitmapTransforms.ts (pure
                            rotate/scale/contrast), scanLoop.ts (DOM-free live
                            scan loop), decodeCascade.ts (still-image views),
                            canvasProbe.ts, imageSource.ts and camera.ts
                            (browser pixel acquisition), BarcodeView
    wallet/                 WalletScreen, CardTile, CardPreview (+ previewMotif),
                            useLongPress, CardMenu
    checkout/               CheckoutScreen, gesture.ts (swipe rules), useWakeLock
    add/                    AddCardFlow, CameraScanner, ImageImport (crop),
                            ManualEntry, CardDetailsForm, captureServices
  styles/                   tokens.css, base.css, app.css
  test/setup.ts             Shared test setup
  test/node/png.ts          Minimal PNG reader for host tests (Node only)
  test/fixtures/qr/         QR import fixtures + manifest.json (exact values)
scripts/generate-qr-fixtures.py  Reproducible QR fixture generator
                            (qrencode CLI + Python Pillow/NumPy)
tsconfig.test-node.json     Type-checks Node-only test code apart from the app
```

Responsibilities and dependency direction:

- **`features/cards/card.ts`, `CardRepository.ts`, `barcodes/formats.ts`** are
  technology-neutral; the UI depends only on the `CardRepository` interface.
- **`barcodes/formats.ts`** is the single registry tying each format to its
  validator, ZXing name, bwip-js encoder, label, and quiet zone. A format is
  supported end to end or not at all.
- **`data/`** owns every IndexedDB detail. Writes resolve only after their
  transaction commits.
- **`add/captureServices.ts`** is the boundary between the add flow and the
  camera/canvas/decoder adapters, so tests inject fakes (jsdom has neither a
  camera nor a canvas).
- **Code splitting**: the add flow (ZXing, cropper, camera) is a lazily loaded
  chunk; bwip-js stays in the main chunk so a tapped card renders immediately.
  Both chunks are precached.

Dependencies added in v0.3.0 (all MIT/Apache-2.0, bundled locally):
`@zxing/library` (Apache-2.0), `bwip-js` (MIT), `react-easy-crop` (MIT).

### Testing

`npm test` runs host tests in jsdom (Vitest):

- **Barcodes**: real bwip-js → in-memory rasterizer → real ZXing round trips
  for every format, leading zeros, symbology preservation, quiet zones,
  validation and check digits.
- **Persistence and migration**: the real repository over `fake-indexeddb`,
  including Blob image storage, seeded v0.2.0 and v0.3.x databases, and the
  wallet-order metadata (append, reorder, restart, damaged metadata).
- **Live scanning** (`camera.test.ts`): the scan loop with fake frames
  (not-ready/zero-size and blank frames, thrown capture and decoder errors,
  continued scheduling, pacing, Code 39 confirmation, exactly-once delivery,
  idempotent stop) and the real camera adapter in jsdom with a fake stream and
  canvas (error mapping, decode of a synthetic Code 128 scene, track cleanup,
  bounded `play()` wait, camera interruption, canvas-read probe).
- **Decoding**: the Code 128 fix, priority formats, decoder-error
  classification, bitmap transforms (no source mutation), and the still-image
  cascade (rotation, inversion, low contrast, enlarged images, time budget).
- **QR image import** (`imageImportDecode.node.test.ts`): real PNG fixtures
  read from disk and decoded through `rgbaToGrey` → cascade, asserting exact
  values, original-first ordering, QR-sweep recovery of the native-resolution
  failures, no cropping of views, and weak-read handling. Only the browser
  canvas step is replaced.
- **Wallet/checkout UI**: tile preview variants (no value encoded, artwork
  object URLs revoked), palette contrast ≥ 4.5:1, checkout card structure
  (name above pagination, barcode inside the card, accent local to the card),
  swipe-down close, and taps/short/diagonal/upward/cancelled gestures not
  closing.
- **App flows**: wallet, drag/keyboard reordering, menu, rename/recolour/delete, checkout
  close/swipe/keys/wake lock, no accent colours on the document root across
  repeated swipes, all three capture paths, crop-retry and image
  fallback, failure messages, scanner stall guidance, Scan again, late and
  duplicate camera callbacks. Camera and canvas decoding are faked here.

These do not prove behaviour on a phone. See the checklist below.

### Real-device checklist (not verifiable in host tests)

**iPhone scanning validation over HTTPS (v0.3.1).** Host tests and desktop
browsers cannot establish iPhone behaviour; record these as real-device
results.

1. `npm run build`, then `npm run preview -- --host 0.0.0.0` (serves `dist`).
2. Point the existing Cloudflare HTTPS tunnel at the preview port.
3. On the iPhone, make sure the new version loaded: close and reopen the
   installed app or tab (the service worker updates on the next load), or
   clear the site's data in Brave. If in doubt, open Scan card, wait 8 s, and
   check **Scan details** shows "Code 128 fix: applied" (v0.3.0 had no such
   panel).
4. In Brave (and Safari for comparison), open **Scan card** and scan physical
   **QR, Code 128, Code 39, UPC-A and EAN-13** samples, in portrait and
   landscape, barcode horizontal and vertical.
5. On the preview screen confirm the exact value, leading zeros, and format.
6. Confirm the camera indicator turns off after a successful scan, after
   **Back**, and after **Scan again**.
7. Try dim light, a slightly blurred/too-close card, off-centre placement, a
   denied permission, and an intentionally unreadable code: after ~8 s the
   guidance and **Scan details** must appear; nothing may sit silently.
8. If scanning still never succeeds, open **Scan details** and note *Camera
   frame*, *Frames checked*, *Blank frames*, *Frame / decoder errors* and
   *Canvas reads*. Many blank frames or "Canvas reads: altered" point at
   browser privacy protection (try Brave Shields off for the site); zero
   frames checked with many "No picture yet" points at video playback.
9. **Import** the original UDF and Kroger screenshots; then test a rotated
   copy and the crop-and-retry path.

**v0.4.2 checks on iPhone (not yet performed).**

1. **QR size.** Open a redrawn QR card and a saved-artwork QR card on the
   narrowest iPhone (SE / mini) and a large one, portrait and landscape: the
   near-square card is fully visible, the code is centred with white space
   around it, and artwork is not stretched or cropped. Swipe to a linear card:
   it returns to the compact face.
2. **Layout.** M8TRX is centred and clear of the notch / Dynamic Island; the
   store name sits directly above the card (a long name wraps to two lines)
   and never overlaps M8TRX or the card; the chevrons stay at the bottom.
3. **Scanning.** Scan the larger QR (redrawn and artwork) and a linear code
   with real checkout hardware, at normal and reduced brightness.
4. **Palette.** The DIM8 colours read well on the phone's display; text and
   inputs remain legible across the wallet, add-card and dialogs.

**v0.4.1 checks on iPhone (not yet performed).**

1. **Dark stage.** Open cards in dark (Slate), bright (Red) and light
   (Yellow, White) colours and swipe between them: the notch / Dynamic
   Island and home-indicator areas stay dark throughout; only the card's own
   bands change colour. Repeat in Brave, Safari and the installed PWA.
2. **Layout.** On the narrowest iPhone and a large one, in portrait and
   landscape: the card is centred with visible dark space around it, the
   store name sits directly above the chevrons (a long name truncates), and
   the × and chevrons are easy to hit. The backdrop stays subtle.
3. **Scanning.** Scan a displayed linear code (Code 128 and EAN/UPC) and a
   QR code with real checkout hardware at the new, smaller size, at normal
   and reduced screen brightness.
4. **Wallet tiles.** The miniature card preview is centred in each tile; a
   two-line name never overlaps it.

**v0.4.0 checks on iPhone (not yet performed).** jsdom host tests cannot
show WebKit safe-area painting, real touch arbitration, scrolling during a
long-press, or the grid animation.

1. **Safe-area colour** (superseded by the v0.4.1 dark stage; the card
   colour no longer reaches the safe areas). Create cards in a dark colour (Slate) and a
   contrasting one (Red), plus a light one (Yellow or White). Open Slate:
   the notch / Dynamic Island area, header and bottom strip (including the
   home-indicator area) are all Slate. Swipe to Red: all three change
   together, immediately. Swipe back and forth several times, also with the
   chevrons. Close: the wallet shows its normal dark background with no
   leftover card colour at the top or bottom. Repeat in Brave, Safari and
   the installed PWA, and on the narrowest available iPhone.
2. **Drag activation.** Press and hold a tile: after about half a second it
   lifts. Drag it to the first position and release; it stays there.
   Quit and reopen the app (and once in airplane mode): the order is kept.
3. **Scrolling.** With enough cards to scroll, swipe quickly over tiles: the
   page scrolls and nothing lifts. During a drag the page must not scroll
   under the finger; holding near the top/bottom edge auto-scrolls.
4. **No accidental actions.** Releasing a drag never opens the card or the
   ⋯ menu; a quick tap still opens the card; ⋯ still opens the menu.
5. **Narrow two-column layout.** On the narrowest iPhone, drag between
   columns and rows, including the last tile of an odd-length wallet; check
   the dashed landing outline and the sliding tiles look right.
6. **Keyboard / VoiceOver.** ⋯ → Move earlier/later/to first/to last;
   VoiceOver announces the new position.

**v0.3.2 checks on iPhone (not yet performed).**

1. Import the QR screenshots that failed after v0.3.1 (Photos and Files);
   confirm the exact value, then try both **Use redrawn QR code** and **Keep
   original artwork**.
2. Re-run the camera scanning checks above (steps 4–6) to confirm live
   scanning still works; its code did not change in v0.3.2.
3. In checkout: swipe down to close, swipe left/right to switch, tap the
   barcode (nothing should happen), and check the bands under the notch and
   home indicator in Safari and the installed PWA, for light (Yellow,
   White) and dark colours and a long store name.

- iPhone Safari and installed PWA: camera permission prompt, rear camera,
  scanning a real card under typical light; Photos/Files import; pinch-zoom
  in the cropper; press-and-hold drag on tiles; horizontal swipe in checkout; wake lock.
- Android Chrome: the same, plus haptic feedback when a drag starts.
- **Scan the displayed barcodes with real checkout hardware** for each format
  you rely on. A successful redraw is not proof of scanner compatibility.

## PWA and offline behaviour

`vite-plugin-pwa` (Workbox `generateSW`) produces `dist/manifest.webmanifest`,
`dist/sw.js`, and a small `registerSW.js` that `index.html` loads.

- The service worker precaches the whole shell: HTML, JS, CSS, the manifest,
  and the icons. After one successful online visit, the app loads offline.
- All navigations fall back to the precached `index.html`.
- There is no runtime caching, because the app requests nothing from other hosts.
- Updates install and activate automatically (`registerType: 'autoUpdate'`).
  Saved cards live in IndexedDB and are never touched by an update; only an
  unsaved form open during an update would be lost. This behaviour is
  unchanged from v0.1.0; a "reload to update" prompt is a possible refinement.
- The service worker is disabled in `npm run dev`.

### Verifying offline support manually

1. `npm run build && npm run preview`, then open the printed URL in Chrome or Edge.
2. In DevTools → **Application** → **Service workers**, confirm `sw.js` is
   activated. Under **Manifest**, confirm the name, icons, and installability.
3. Reload once so the page is controlled by the service worker.
4. Add a card or two (manual entry works without a camera).
5. In DevTools → **Network**, choose **Offline** and reload. The app and the
   saved cards should still appear; opening cards, adding (including the
   decoder and cropper), renaming, and deleting still work.
6. Close the browser completely, reopen it (still offline if you like), and
   open the app again. The cards should still be there.

On a phone, use the browser's "Install app" / "Add to Home Screen" action. PWA
installation requires HTTPS, except on `localhost`.

## Icons

The icons are placeholder artwork: a stylised card on the accent colour. They
are generated from the geometry and colours in `scripts/generate-icons.mjs`.
Do not edit the PNGs by hand. Change the script and run `npm run icons`.
Replace the artwork if authoritative DIM8 brand assets become available.

The icons still use the original blue accent (`#1f4fd8`) and were not
regenerated for the dark theme; that artwork is unchanged pending brand
assets.

The page background colour (`#010100`, the official DIM8 background)
appears in three places. Keep them in
sync: `--color-bg` in `src/styles/tokens.css`, `THEME_COLOR` /
`BACKGROUND_COLOR` in `vite.config.ts`, and `theme-color` plus the inline
`<html>` background in `index.html` (which prevents a light flash before the
stylesheet loads).
