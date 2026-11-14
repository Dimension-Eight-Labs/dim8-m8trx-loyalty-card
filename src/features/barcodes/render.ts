/**
 * Barcode rendering with bwip-js (a JavaScript port of Barcode Writer in Pure
 * PostScript). Produces crisp SVG from the stored value and symbology; the app
 * never shows a photograph when it can redraw the code.
 *
 * Only the encoders for formats in the registry are imported by name, so the
 * bundler can drop the ~100 symbologies we never use.
 *
 * Safety: bwip-js builds the SVG from geometry only (bars, modules, and glyph
 * outlines from its embedded OCR-B font). User text is never inserted into
 * markup, and the result is shown through an <img> data URL, which cannot run
 * script. See BarcodeImage.tsx.
 *
 * Errors: bwip-js throws for data it cannot encode (bad check digit, capacity
 * exceeded, unsupported characters). renderBarcodeSvg converts that into a
 * BarcodeRenderError with a user-presentable message.
 */
import {
  azteccode,
  code128,
  code39,
  datamatrix,
  drawingSVG,
  ean13,
  ean8,
  pdf417,
  qrcode,
  upca,
  type DrawingContext,
  type RenderOptions,
} from 'bwip-js/browser'
import { FORMAT_SPECS, type BarcodeFormat } from './formats.ts'

type Encoder = <T>(opts: RenderOptions, drawing: DrawingContext<T>) => T

/** Explicit format → encoder table: no lookup by string, no fallbacks. */
const ENCODERS: Record<BarcodeFormat, Encoder> = {
  code128: code128 as Encoder,
  code39: code39 as Encoder,
  ean13: ean13 as Encoder,
  upca: upca as Encoder,
  ean8: ean8 as Encoder,
  qrcode: qrcode as Encoder,
  pdf417: pdf417 as Encoder,
  datamatrix: datamatrix as Encoder,
  azteccode: azteccode as Encoder,
}

/**
 * Size of one module in bwip-js points at scale 1. Linear symbols use a 1pt
 * narrow bar; BWIPP draws 2D modules 2pt wide by default. Padding is given in
 * points, so quiet zones are converted with this factor.
 */
const MODULE_POINTS: Record<'1d' | '2d', number> = { '1d': 1, '2d': 2 }

export class BarcodeRenderError extends Error {
  constructor(message = 'This barcode can’t be drawn from its value.') {
    super(message)
    this.name = 'BarcodeRenderError'
  }
}

export interface BarcodeRenderOptions {
  /** Pixels per point. The SVG scales freely; this mostly affects raster output. */
  scale?: number
  /** Print human-readable digits under linear codes (default: per format). */
  includeText?: boolean
}

/** Builds the bwip-js options for a format. Exported for the rasterizer and tests. */
export function buildRenderOptions(
  format: BarcodeFormat,
  value: string,
  options: BarcodeRenderOptions = {},
): RenderOptions {
  const spec = FORMAT_SPECS[format]
  const quiet = spec.quietZone * MODULE_POINTS[spec.dimension]
  const includeText = options.includeText ?? spec.humanReadable
  const base: RenderOptions = {
    bcid: spec.bwipId,
    text: value,
    scale: options.scale ?? 2,
    // A white background makes the quiet zone part of the image itself, so it
    // survives any surrounding styling.
    backgroundcolor: 'FFFFFF',
    paddingwidth: quiet,
    paddingheight: spec.dimension === '1d' ? 4 : quiet,
  }
  if (spec.dimension === '1d') {
    // Bar height in millimetres (BWIPP units). ~18 mm keeps the symbol
    // roughly 3:1 or squatter, which suits phone screens in portrait.
    base.height = 18
    if (includeText) {
      base.includetext = true
      // EAN/UPC have a standard digit layout (first digit in the left quiet
      // zone, groups under the halves) that BWIPP draws by default; forcing
      // alignment would overlap the bars. Only free-text symbologies centre.
      if (format === 'code128' || format === 'code39') base.textxalign = 'center'
    }
  }
  return base
}

/** Renders any drawing context; shared by SVG output and the rasterizer. */
export function renderWith<T>(
  format: BarcodeFormat,
  value: string,
  drawing: DrawingContext<T>,
  options: BarcodeRenderOptions = {},
): T {
  try {
    return ENCODERS[format](buildRenderOptions(format, value, options), drawing)
  } catch (error) {
    throw new BarcodeRenderError(friendlyBwipMessage(error))
  }
}

/** SVG markup for `value` in `format`. Throws BarcodeRenderError on failure. */
export function renderBarcodeSvg(format: BarcodeFormat, value: string, options?: BarcodeRenderOptions): string {
  return renderWith(format, value, drawingSVG(), options)
}

/** `data:` URL for an <img>. Synchronous and needs no cleanup, unlike blob URLs. */
export function svgToDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

function friendlyBwipMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  if (/check digit/i.test(raw)) return 'The check digit doesn’t match. Check the number for typos.'
  if (/too (long|large)|exceeds|capacity|maximum/i.test(raw)) return 'There’s too much data for this barcode format.'
  return 'This value can’t be drawn in the selected barcode format.'
}
