/**
 * Rendered-layout regression tests for the Color and Icon pickers (v0.6.1
 * narrow-screen correction). Run with `npm run test:layout`; see
 * playwright.config.ts for the browser and server setup.
 *
 * The defect these guard against was invisible to the jsdom suite: at a 320px
 * viewport the five-column grid inside the card-menu dialog squeezed each
 * column to ~41px, so the swatch's 48px minimum height overrode its square
 * aspect ratio (41.2 × 48 cells), and the nowrap/ellipsis icon label showed
 * "Hard…". Long single words ("Gunmetal", "Burgundy") were also split
 * mid-word in narrow five-column grids. Every assertion here is therefore about measured geometry
 * (getBoundingClientRect) in a real browser, not about CSS declarations.
 *
 * Coverage: both picker hosts (the Add Card details form, which sits in the
 * padded app shell, and the narrower card-menu dialog), at each required
 * viewport width. Per rendered picker the tests check: square, equal-sized,
 * touch-sized swatches; the expected column count for the measured component
 * width; no horizontal overflow of the picker or the page; every label
 * complete, unclipped and not overlapping a neighbour; the selection check
 * placed inside and aligned to its swatch; radio selection moving with a tap;
 * and all 15 colours / 10 icon choices present with complete accessible names.
 *
 * Measurements are logged as one JSON line per picker ("[picker-layout] …")
 * so a run doubles as the layout report for review handoffs.
 */
import { expect, test, type Locator, type Page } from '@playwright/test'
import { CARD_ICONS } from '../src/features/cards/cardIcons.ts'
import { TILE_COLORS } from '../src/features/cards/tileColors.ts'

// ---- Requirements -----------------------------------------------------------

/** Viewport widths required by the v0.6.1 correction (CSS px). */
const WIDTHS = [320, 340, 360, 375, 390] as const

/**
 * Component-width breakpoint, mirrored from app.css (19rem at the default
 * 16px root size). It is the larger of two requirements: five square 48px
 * swatches (5 × 48 + 4 × 8 = 272px), and a column plus one gap wide enough
 * for the longest whole label word (~62.5px: 5 × 54.5 + 4 × 8 ≈ 304px).
 * A picker narrower than this must use four columns.
 */
const FIVE_COLUMN_MIN_WIDTH = 304

/**
 * Extra viewports either side of the dialog's breakpoint: the dialog picker
 * is viewport − 82px wide, so 386px gives exactly 304px (five columns) and
 * 385px gives 303px (four columns).
 */
const DIALOG_CHROME = 82
const BOUNDARY_WIDTHS = [FIVE_COLUMN_MIN_WIDTH + DIALOG_CHROME - 1, FIVE_COLUMN_MIN_WIDTH + DIALOG_CHROME] as const

/** Minimum practical touch target (Apple HIG 44pt); the design target is 48. */
const MIN_TOUCH = 44
/** Design swatch size range: the 48px touch target up to the 3.5rem cap. */
const SWATCH_MIN = 48
const SWATCH_MAX = 56
/** Grid gap (--space-2). */
const GAP = 8
/** Subpixel tolerance for rendered geometry at deviceScaleFactor 3. */
const EPS = 0.5

/**
 * Approved iPhone 13 (390px) geometry, measured in this suite on the v0.6.1
 * baseline commit (0b2f093) before this correction. The Add Card form gives
 * each picker 358px (390 − 2 × 16px shell padding): five 65.2px columns with
 * 56px (capped) swatches. The card-menu dialog gives 308px
 * (390 − 2 × 16 backdrop − 2 × 24 panel padding − 2 × 1 border): five 55.2px
 * columns with 55.2px swatches. These values must not change.
 */
const APPROVED_390 = {
  form: { pickerWidth: 358, columns: 5, swatch: 56 },
  dialog: { pickerWidth: 308, columns: 5, swatch: 55.2 },
} as const

const COLOR_LABELS = TILE_COLORS.map((color) => color.label)
const ICON_LABELS = ['None', ...CARD_ICONS.map((icon) => icon.label)]

// ---- Browser-side measurement --------------------------------------------------

interface Box {
  left: number
  right: number
  top: number
  bottom: number
  width: number
  height: number
}

interface OptionLayout {
  label: string
  checked: boolean
  option: Box
  swatch: Box
  labelBox: Box
  /** Union of the label text's line boxes (overflowing or ellipsized text extends past labelBox). */
  text: Box
  lines: number
  /** Words whose glyphs land on more than one line (a mid-word break). */
  splitWords: string[]
  labelScrollWidth: number
  labelClientWidth: number
  check: Box | null
}

interface PickerLayout {
  viewportWidth: number
  documentScrollWidth: number
  /** The picker's host surface: the dialog panel or the app shell. */
  host: Box
  picker: Box
  pickerScrollWidth: number
  pickerClientWidth: number
  grid: Box
  gridScrollWidth: number
  gridClientWidth: number
  columnGap: number
  columns: number
  options: OptionLayout[]
}

/** Measures one rendered picker (`group` is its fieldset). Runs in the page. */
async function measure(group: Locator): Promise<PickerLayout> {
  return group.evaluate((fieldset) => {
    const box = (rect: DOMRect) => ({
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
    })
    const grid = fieldset.querySelector<HTMLElement>('.color-picker__swatches, .icon-picker__options')!
    const options = Array.from(grid.children as HTMLCollectionOf<HTMLElement>).map((option) => {
      const swatch = option.querySelector<HTMLElement>('.color-picker__swatch, .icon-picker__swatch')!
      const label = option.querySelector<HTMLElement>('.color-picker__label, .icon-picker__label')!
      const input = option.querySelector<HTMLInputElement>('input[type="radio"]')!
      // Colour check: the centred CheckIcon; icon check: the corner badge.
      const check = swatch.querySelector<HTMLElement>('.icon-picker__check') ?? swatch.querySelector<SVGElement>('svg.button__icon')
      const range = document.createRange()
      range.selectNodeContents(label)
      const lineTops = new Set(Array.from(range.getClientRects(), (rect) => Math.round(rect.top)))
      // A word split across lines has client rects on more than one line.
      const textNode = label.firstChild
      const splitWords: string[] = []
      if (textNode?.nodeType === Node.TEXT_NODE) {
        for (const match of (textNode.textContent ?? '').matchAll(/\S+/g)) {
          const word = document.createRange()
          word.setStart(textNode, match.index)
          word.setEnd(textNode, match.index + match[0].length)
          if (new Set(Array.from(word.getClientRects(), (rect) => Math.round(rect.top))).size > 1) splitWords.push(match[0])
        }
      }
      return {
        label: label.textContent ?? '',
        checked: input.checked,
        option: box(option.getBoundingClientRect()),
        swatch: box(swatch.getBoundingClientRect()),
        labelBox: box(label.getBoundingClientRect()),
        text: box(range.getBoundingClientRect()),
        lines: lineTops.size,
        splitWords,
        labelScrollWidth: label.scrollWidth,
        labelClientWidth: label.clientWidth,
        check: check ? box(check.getBoundingClientRect()) : null,
      }
    })
    const firstRowTop = options[0]!.swatch.top
    return {
      viewportWidth: window.innerWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      host: box((fieldset.closest('.dialog') ?? fieldset.closest('.app-shell'))!.getBoundingClientRect()),
      picker: box(fieldset.getBoundingClientRect()),
      pickerScrollWidth: fieldset.scrollWidth,
      pickerClientWidth: fieldset.clientWidth,
      grid: box(grid.getBoundingClientRect()),
      gridScrollWidth: grid.scrollWidth,
      gridClientWidth: grid.clientWidth,
      columnGap: parseFloat(getComputedStyle(grid).columnGap),
      columns: options.filter((option) => Math.abs(option.swatch.top - firstRowTop) < 1).length,
      options,
    }
  })
}

// ---- Assertions ------------------------------------------------------------------

const round = (value: number) => Math.round(value * 10) / 10

/** One compact JSON line per picker for the handoff report. */
function report(name: string, layout: PickerLayout) {
  const swatch = layout.options[0]!.swatch
  const wrapped = layout.options.filter((option) => option.lines > 1).map((option) => option.label)
  // Labels wider than their column plus half a gap each side (a single long word kept whole).
  const columnWidth = (layout.grid.width - (layout.columns - 1) * layout.columnGap) / layout.columns
  const overhanging = layout.options
    .filter((option) => option.labelBox.width > columnWidth + layout.columnGap + EPS)
    .map((option) => `${option.label} +${round(option.labelBox.width - columnWidth - layout.columnGap)}px`)
  console.log(
    `[picker-layout] ${JSON.stringify({
      picker: name,
      viewport: layout.viewportWidth,
      pickerWidth: round(layout.grid.width),
      columns: layout.columns,
      gap: layout.columnGap,
      swatch: `${round(swatch.width)}x${round(swatch.height)}`,
      wrappedLabels: wrapped,
      overhangingLabels: overhanging,
      pageOverflow: layout.documentScrollWidth > layout.viewportWidth,
    })}`,
  )
}

/** Geometry checks shared by every picker at every width. */
function expectUsableLayout(name: string, layout: PickerLayout, expectedLabels: string[]) {
  const at = (detail: string) => `${name} @${layout.viewportWidth}px: ${detail}`

  // All choices present, in order, with complete text.
  expect(layout.options.map((option) => option.label), at('labels')).toEqual(expectedLabels)

  // No horizontal overflow: the page never scrolls sideways and the picker
  // stays inside the viewport. (Labels may overhang the grid by half a gap
  // into the surrounding padding by design; checked per label below.)
  expect(layout.documentScrollWidth, at('page scroll width')).toBeLessThanOrEqual(layout.viewportWidth)
  expect(layout.picker.left, at('picker left edge')).toBeGreaterThanOrEqual(0)
  expect(layout.picker.right, at('picker right edge')).toBeLessThanOrEqual(layout.viewportWidth)

  // Column count follows the measured component width, not the device.
  const expectedColumns = layout.grid.width + EPS >= FIVE_COLUMN_MIN_WIDTH ? 5 : 4
  expect(layout.columns, at(`columns for a ${round(layout.grid.width)}px picker`)).toBe(expectedColumns)
  expect(layout.columnGap, at('gap')).toBe(GAP)

  const reference = layout.options[0]!.swatch
  for (const option of layout.options) {
    const { swatch } = option
    const where = (detail: string) => at(`${option.label} ${detail}`)

    // Square, touch-sized, and identical for every option (selected or not).
    expect(Math.abs(swatch.width - swatch.height), where(`square (${swatch.width}x${swatch.height})`)).toBeLessThanOrEqual(EPS)
    expect(swatch.width, where('touch width')).toBeGreaterThanOrEqual(MIN_TOUCH)
    expect(swatch.height, where('touch height')).toBeGreaterThanOrEqual(MIN_TOUCH)
    // The column fallback keeps the 48px design target at every supported width.
    expect(swatch.width, where('48px design minimum')).toBeGreaterThanOrEqual(SWATCH_MIN - EPS)
    expect(swatch.width, where('cap')).toBeLessThanOrEqual(SWATCH_MAX + EPS)
    expect(Math.abs(swatch.width - reference.width), where('same width as other swatches')).toBeLessThanOrEqual(EPS)
    expect(Math.abs(swatch.height - reference.height), where('same height as other swatches')).toBeLessThanOrEqual(EPS)

    // The whole option (swatch + label) is the tap target and is at least touch-sized.
    expect(option.option.height, where('option height')).toBeGreaterThanOrEqual(MIN_TOUCH)

    // Label complete: no clipped/ellipsized text, no word split across lines, below its swatch.
    expect(option.labelScrollWidth, where('label scroll width')).toBeLessThanOrEqual(option.labelClientWidth)
    expect(option.splitWords, where('words split across lines')).toEqual([])
    expect(option.text.left, where('text left')).toBeGreaterThanOrEqual(option.labelBox.left - EPS)
    expect(option.text.right, where('text right')).toBeLessThanOrEqual(option.labelBox.right + EPS)
    // A label may extend past its column into the gaps (centred, by design),
    // and an edge label slightly past the grid into the surrounding padding,
    // but never past the dialog panel / app shell or the viewport.
    expect(option.labelBox.left, where('label inside host (left)')).toBeGreaterThanOrEqual(layout.host.left - EPS)
    expect(option.labelBox.right, where('label inside host (right)')).toBeLessThanOrEqual(layout.host.right + EPS)
    expect(option.labelBox.left, where('label inside viewport (left)')).toBeGreaterThanOrEqual(0)
    expect(option.labelBox.right, where('label inside viewport (right)')).toBeLessThanOrEqual(layout.viewportWidth)
    // Swatch and option column stay inside the grid exactly.
    expect(swatch.left, where('swatch inside grid (left)')).toBeGreaterThanOrEqual(layout.grid.left - EPS)
    expect(swatch.right, where('swatch inside grid (right)')).toBeLessThanOrEqual(layout.grid.right + EPS)
    expect(option.option.left, where('option inside grid (left)')).toBeGreaterThanOrEqual(layout.grid.left - EPS)
    expect(option.option.right, where('option inside grid (right)')).toBeLessThanOrEqual(layout.grid.right + EPS)
    expect(option.labelBox.top, where('label below swatch')).toBeGreaterThanOrEqual(swatch.bottom - EPS)
    // Centred under the swatch (consistent alignment, whether wrapped or not).
    const labelCentre = (option.text.left + option.text.right) / 2
    const swatchCentre = (swatch.left + swatch.right) / 2
    expect(Math.abs(labelCentre - swatchCentre), where('label centred')).toBeLessThanOrEqual(1)

    // Selection check: present only when checked, inside and aligned to its swatch.
    if (!option.checked) {
      expect(option.check, where('unchecked has no check')).toBeNull()
      continue
    }
    expect(option.check, where('checked has a check')).not.toBeNull()
    const check = option.check!
    expect(check.left, where('check inside (left)')).toBeGreaterThanOrEqual(swatch.left - EPS)
    expect(check.right, where('check inside (right)')).toBeLessThanOrEqual(swatch.right + EPS)
    expect(check.top, where('check inside (top)')).toBeGreaterThanOrEqual(swatch.top - EPS)
    expect(check.bottom, where('check inside (bottom)')).toBeLessThanOrEqual(swatch.bottom + EPS)
    if (name.includes('icon')) {
      // Corner badge 3px from the swatch's right and bottom edges.
      expect(Math.abs(swatch.right - check.right - 3), where('badge right offset')).toBeLessThanOrEqual(EPS)
      expect(Math.abs(swatch.bottom - check.bottom - 3), where('badge bottom offset')).toBeLessThanOrEqual(EPS)
    } else {
      // Centred check mark.
      expect(Math.abs((check.left + check.right) / 2 - swatchCentre), where('check centred x')).toBeLessThanOrEqual(EPS)
      expect(Math.abs((check.top + check.bottom) / 2 - (swatch.top + swatch.bottom) / 2), where('check centred y')).toBeLessThanOrEqual(EPS)
    }
  }

  // Labels in the same row never overlap their neighbours.
  const rows = new Map<number, OptionLayout[]>()
  for (const option of layout.options) {
    const key = Math.round(option.swatch.top)
    rows.set(key, [...(rows.get(key) ?? []), option])
  }
  for (const row of rows.values()) {
    for (let i = 1; i < row.length; i++) {
      expect(row[i]!.text.left, at(`${row[i - 1]!.label} / ${row[i]!.label} labels overlap`)).toBeGreaterThanOrEqual(row[i - 1]!.text.right)
    }
  }
}

/** Checks the approved 390px geometry is unchanged. */
function expectApproved390(layout: PickerLayout, approved: { pickerWidth: number; columns: number; swatch: number }) {
  if (layout.viewportWidth !== 390) return
  expect(layout.grid.width).toBeCloseTo(approved.pickerWidth, 0)
  expect(layout.columns).toBe(approved.columns)
  expect(layout.columnGap).toBe(GAP)
  for (const option of layout.options) {
    expect(option.swatch.width).toBeCloseTo(approved.swatch, 1)
    expect(option.swatch.height).toBeCloseTo(approved.swatch, 1)
  }
}

/** Every radio has its complete accessible name. */
async function expectAccessibleNames(group: Locator, labels: string[]) {
  const radios = group.getByRole('radio')
  await expect(radios).toHaveCount(labels.length)
  for (const label of labels) await expect(group.getByRole('radio', { name: label, exact: true })).toHaveCount(1)
}

/**
 * Taps `target`'s option and checks the radio and the visible check move
 * there (one check in the whole picker), then re-measures.
 */
async function expectSelectionMoves(name: string, group: Locator, target: string): Promise<PickerLayout> {
  const radio = group.getByRole('radio', { name: target, exact: true })
  // The radio is invisible and covers its whole option; tap the option (its parent label).
  await radio.locator('xpath=..').click()
  await expect(radio).toBeChecked()
  const layout = await measure(group)
  const checked = layout.options.filter((option) => option.checked)
  expect(checked.map((option) => option.label), `${name}: checked option`).toEqual([target])
  expect(layout.options.filter((option) => option.check).map((option) => option.label), `${name}: visible check`).toEqual([target])
  return layout
}

/** Full check of one rendered picker: initial state, then after selecting `target`. */
async function checkPicker(name: string, group: Locator, labels: string[], target: string, approved: { pickerWidth: number; columns: number; swatch: number }) {
  await expect(group).toBeVisible()
  await expectAccessibleNames(group, labels)
  const initial = await measure(group)
  report(name, initial)
  expectUsableLayout(name, initial, labels)
  expectApproved390(initial, approved)
  const selected = await expectSelectionMoves(name, group, target)
  expectUsableLayout(`${name} after selecting ${target}`, selected, labels)
  // Selecting never changes swatch geometry.
  expect(selected.options[0]!.swatch.width).toBeCloseTo(initial.options[0]!.swatch.width, 1)
  expect(selected.options[0]!.swatch.height).toBeCloseTo(initial.options[0]!.swatch.height, 1)
}

// ---- Navigation ------------------------------------------------------------------

/** Opens the Add Card details form, then saves a card and opens its menu dialog. */
async function openCardMenu(page: Page) {
  await openDetailsForm(page)
  await page.getByLabel('Store name').fill('Layout Test')
  await page.getByRole('button', { name: 'Save card' }).click()
  await page.getByRole('button', { name: 'Options for Layout Test' }).click()
  return page.getByRole('dialog')
}

/** Opens the Add Card details form (manual entry, Code 128). */
async function openDetailsForm(page: Page) {
  await page.goto('./')
  await page.getByRole('button', { name: 'Add Card', exact: true }).click()
  await page.getByRole('button', { name: /enter manually/i }).click()
  await page.getByLabel('Barcode value').fill('M8TRX-LAYOUT-1')
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByLabel('Store name')).toBeVisible()
}

// ---- Tests -----------------------------------------------------------------------

for (const width of WIDTHS) {
  test.describe(`pickers at ${width}px`, () => {
    test.use({ viewport: { width, height: 844 } })

    test('Add Card form: Color and Icon pickers', async ({ page }) => {
      await openDetailsForm(page)
      // Hardware is the long icon label from the original defect; Brushed Steel a long colour name.
      await checkPicker('form color picker', page.getByRole('group', { name: 'Color', exact: true }), COLOR_LABELS, 'Brushed Steel', APPROVED_390.form)
      await checkPicker('form icon picker', page.getByRole('group', { name: 'Icon', exact: true }), ICON_LABELS, 'Hardware', APPROVED_390.form)
    })

    test('card menu dialog: Change color and Change icon pickers', async ({ page }) => {
      const dialog = await openCardMenu(page)
      await dialog.getByRole('button', { name: 'Change color' }).click()
      await checkPicker('dialog color picker', dialog.getByRole('group', { name: 'Tile color', exact: true }), COLOR_LABELS, 'Obsidian Black', APPROVED_390.dialog)
      await dialog.getByRole('button', { name: 'Cancel' }).click()

      await dialog.getByRole('button', { name: 'Change icon' }).click()
      await checkPicker('dialog icon picker', dialog.getByRole('group', { name: 'Icon', exact: true }), ICON_LABELS, 'Hardware', APPROVED_390.dialog)
    })
  })
}

for (const width of BOUNDARY_WIDTHS) {
  test.describe(`dialog pickers at the ${FIVE_COLUMN_MIN_WIDTH}px breakpoint (${width}px viewport)`, () => {
    test.use({ viewport: { width, height: 844 } })

    test('switch between five and four columns at the component width', async ({ page }) => {
      const dialog = await openCardMenu(page)
      await dialog.getByRole('button', { name: 'Change color' }).click()
      const group = dialog.getByRole('group', { name: 'Tile color', exact: true })
      const layout = await measure(group)
      report('dialog color picker (boundary)', layout)
      expect(layout.grid.width).toBeCloseTo(width - DIALOG_CHROME, 1)
      expect(layout.columns).toBe(width - DIALOG_CHROME >= FIVE_COLUMN_MIN_WIDTH ? 5 : 4)
      expectUsableLayout('dialog color picker (boundary)', layout, COLOR_LABELS)
      await dialog.getByRole('button', { name: 'Cancel' }).click()
      await dialog.getByRole('button', { name: 'Change icon' }).click()
      await checkPicker('dialog icon picker (boundary)', dialog.getByRole('group', { name: 'Icon', exact: true }), ICON_LABELS, 'Hardware', APPROVED_390.dialog)
    })
  })
}
