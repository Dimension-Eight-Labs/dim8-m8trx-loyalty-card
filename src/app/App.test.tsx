/**
 * Integration tests: the full App wired to the real IndexedDB repository
 * (fake-indexeddb) and the real barcode renderer/verifier. Camera and image
 * decoding are replaced by fakes because jsdom has no camera or canvas; the
 * real decoder is covered in barcodes.test.ts. Unmounting and rendering again
 * with a new repository instance on the same database simulates an app restart.
 *
 * These are host tests in jsdom, not tests on a phone or a real browser.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createIndexedDbCardRepository } from '../data/indexedDbCardRepository.ts'
import type { CameraScanOptions, CaptureServices, DecodeResult, FoundResult, ScanDiagnostics } from '../features/add/captureServices.ts'
import { verifyRoundTrip } from '../features/barcodes/verify.ts'
import type { CardRepository } from '../features/cards/CardRepository.ts'
import { LONG_PRESS_MS } from '../features/wallet/useWalletReorder.ts'
import { App, LOADING_MESSAGE } from './App.tsx'

let factory: IDBFactory

beforeEach(() => {
  factory = new IDBFactory()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function makeRepository() {
  return createIndexedDbCardRepository({ indexedDB: factory })
}

/** Fake capture adapters with the real round-trip verifier. */
function fakeCapture(overrides: Partial<CaptureServices> = {}): CaptureServices {
  return {
    startCamera: vi.fn(async (_video, onResult) => {
      setTimeout(() => onResult({ status: 'decoded', format: 'code128', value: '0012345' }), 0)
      return { stop: vi.fn() }
    }),
    loadImage: vi.fn(async () => ({ url: 'blob:fake', width: 400, height: 200, release: vi.fn() })),
    decodeImage: vi.fn(async (): Promise<DecodeResult> => ({ status: 'not-found' })),
    cropImage: vi.fn(async () => new Blob(['png-bytes'], { type: 'image/png' })),
    verify: verifyRoundTrip,
    ...overrides,
  }
}

/** Privacy-safe scan diagnostics as the camera adapter reports them. */
function diagnostics(overrides: Partial<ScanDiagnostics> = {}): ScanDiagnostics {
  return {
    phase: 'scanning',
    ticks: 40,
    framesDecoded: 40,
    framesNotReady: 0,
    blankFrames: 0,
    frameErrors: 0,
    decoderErrors: 0,
    misses: 40,
    unconfirmedReads: 0,
    frameWidth: 1080,
    frameHeight: 1920,
    sampleWidth: 507,
    sampleHeight: 432,
    lastTickMs: 85,
    elapsedMs: 9000,
    track: { width: 1080, height: 1920, frameRate: 30, facingMode: 'environment' },
    canvasReadback: 'ok',
    playback: 'playing',
    code128Patch: 'applied',
    ...overrides,
  }
}

/** A fake camera whose callbacks the test drives by hand. */
function controllableCamera() {
  const sessions: Array<{ stop: ReturnType<typeof vi.fn>; onResult: (r: FoundResult) => void; options?: CameraScanOptions }> = []
  const startCamera = vi.fn(async (_video: HTMLVideoElement, onResult: (r: FoundResult) => void, options?: CameraScanOptions) => {
    const session = { stop: vi.fn(), onResult, options }
    sessions.push(session)
    return { stop: session.stop }
  })
  return { startCamera, sessions }
}

function renderApp(repository: CardRepository = makeRepository(), capture: CaptureServices = fakeCapture()) {
  const user = userEvent.setup()
  const view = render(<App repository={repository} capture={capture} />)
  return { user, capture, ...view }
}

/** Adds a card through manual entry. */
async function addManualCard(user: UserEvent, storeName: string, value: string, format = 'Code 128', color?: string) {
  await user.click(await screen.findByRole('button', { name: /add card/i }))
  await user.click(await screen.findByRole('button', { name: /enter manually/i }))
  await user.selectOptions(screen.getByLabelText('Barcode format'), format)
  await user.type(screen.getByLabelText('Barcode value'), value)
  await user.click(screen.getByRole('button', { name: 'Continue' }))
  await user.type(await screen.findByLabelText('Store name'), storeName)
  if (color) await user.click(screen.getByRole('radio', { name: color }))
  await user.click(screen.getByRole('button', { name: 'Save card' }))
  await screen.findByRole('button', { name: storeName })
}

/** Tile names in on-screen order. */
function tileOrder(): string[] {
  return Array.from(document.querySelectorAll('.tile__name'), (node) => node.textContent ?? '')
}

/**
 * jsdom has no layout, so give the wallet a fake two-column grid of 100 px
 * tiles. Offsets follow each tile's current DOM position, so they stay right
 * after React reorders the tiles. Tile i's centre is centre(i).
 */
const TILE = 100
function layoutWallet() {
  const grid = document.querySelector('.wallet-grid') as HTMLElement
  for (const tile of Array.from(grid.children) as HTMLElement[]) {
    const index = () => Array.from(tile.parentElement?.children ?? []).indexOf(tile)
    Object.defineProperties(tile, {
      offsetLeft: { configurable: true, get: () => (index() % 2) * TILE },
      offsetTop: { configurable: true, get: () => Math.floor(index() / 2) * TILE },
      offsetWidth: { configurable: true, get: () => TILE },
      offsetHeight: { configurable: true, get: () => TILE },
    })
  }
}
function centre(index: number) {
  return { clientX: (index % 2) * TILE + TILE / 2, clientY: Math.floor(index / 2) * TILE + TILE / 2 }
}

/** Fakes only setTimeout so the long-press timer is controllable while fake-indexeddb keeps running. */
function fakeLongPressTimer() {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
}

/** Long-press (touch) the tile at `from`, drag it over the tile at `to`, release, then the browser's click. */
function touchDrag(name: string, from: number, to: number) {
  const tile = screen.getByRole('button', { name })
  fakeLongPressTimer()
  fireEvent.pointerDown(tile, { pointerId: 1, pointerType: 'touch', isPrimary: true, button: 0, ...centre(from) })
  act(() => {
    vi.advanceTimersByTime(LONG_PRESS_MS)
  })
  vi.useRealTimers()
  expect(tile.closest('li')).toHaveClass('tile--dragging')
  fireEvent.pointerMove(tile, { pointerId: 1, pointerType: 'touch', ...centre(to) })
  fireEvent.pointerUp(tile, { pointerId: 1, pointerType: 'touch', ...centre(to) })
  fireEvent.click(tile)
}

describe('App', () => {
  it('shows a loading state, then the empty state, inside the landmarks', async () => {
    renderApp()

    expect(screen.getByText(LOADING_MESSAGE)).toHaveAttribute('role', 'status')
    expect(await screen.findByRole('heading', { level: 1, name: 'No cards yet' })).toBeInTheDocument()
    expect(screen.getByRole('banner')).toBeInTheDocument()
    expect(screen.getByRole('main')).toBeInTheDocument()
  })

  it('adds a card manually and shows it as a tile with only its name', async () => {
    const { user } = renderApp()

    await addManualCard(user, 'Corner Coffee', '0012 3456', 'Code 128', 'Green')

    const tile = screen.getByRole('button', { name: 'Corner Coffee' })
    expect(tile.closest('li')).toHaveStyle({ background: '#2e7d32' })
    // The home screen shows no card number.
    expect(screen.queryByText('0012 3456')).not.toBeInTheDocument()
    expect(screen.getByText('Card saved.')).toBeInTheDocument()
  })

  it('shows a miniature card preview on each tile: bars for linear codes, a QR motif for QR codes', async () => {
    const { user } = renderApp()
    await addManualCard(user, 'Bar Shop', '0012', 'Code 128', 'Red')
    await addManualCard(user, 'QR Shop', 'MEMBER 1', 'QR code', 'White')

    const barTile = screen.getByRole('button', { name: 'Bar Shop' })
    const qrTile = screen.getByRole('button', { name: 'QR Shop' })
    expect(barTile.querySelector('[data-preview="linear"]')).toBeInTheDocument()
    expect(qrTile.querySelector('[data-preview="qr"]')).toBeInTheDocument()
    expect(qrTile.closest('li')!.style.getPropertyValue('--tile-accent')).toBe('#eceff1')
    // Still no card data on the home screen.
    expect(screen.queryByText('0012')).not.toBeInTheDocument()
    expect(screen.queryByText('MEMBER 1')).not.toBeInTheDocument()
  })

  it('validates manual entry against the format and check digit', async () => {
    const { user } = renderApp()
    await user.click(await screen.findByRole('button', { name: /add card/i }))
    await user.click(screen.getByRole('button', { name: /enter manually/i }))
    await user.selectOptions(screen.getByLabelText('Barcode format'), 'EAN-13')
    await user.type(screen.getByLabelText('Barcode value'), '0012345678901')
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(screen.getByRole('alert')).toHaveTextContent(/check digit/i)
    expect(screen.queryByLabelText('Store name')).not.toBeInTheDocument()
    expect(screen.queryByRole('img', { name: /preview/i })).not.toBeInTheDocument()

    await user.clear(screen.getByLabelText('Barcode value'))
    await user.type(screen.getByLabelText('Barcode value'), '0012345678905')
    expect(screen.getByRole('img', { name: /preview.*EAN-13/i })).toBeInTheDocument()
  })

  it('shows the format and exact value for verification before saving, and keeps it on Back', async () => {
    const { user } = renderApp()
    await user.click(await screen.findByRole('button', { name: /add card/i }))
    await user.click(screen.getByRole('button', { name: /enter manually/i }))
    await user.selectOptions(screen.getByLabelText('Barcode format'), 'UPC-A')
    await user.type(screen.getByLabelText('Barcode value'), '012345678905')
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(await screen.findByText('012345678905')).toBeInTheDocument()
    expect(screen.getByText('UPC-A')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /captured barcode/i })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByLabelText('Barcode value')).toHaveValue('012345678905')
  })

  it('requires a store name before saving', async () => {
    const { user } = renderApp()
    await user.click(await screen.findByRole('button', { name: /add card/i }))
    await user.click(screen.getByRole('button', { name: /enter manually/i }))
    await user.type(screen.getByLabelText('Barcode value'), 'ABC')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(await screen.findByRole('button', { name: 'Save card' }))

    expect(screen.getByText('Enter the store name.')).toHaveAttribute('role', 'alert')
    expect(screen.getByLabelText('Store name')).toHaveFocus()
  })

  it('scans a card with the camera and saves the exact decoded value and symbology', async () => {
    const repository = makeRepository()
    const { user, capture } = renderApp(repository)

    await user.click(await screen.findByRole('button', { name: /add card/i }))
    await user.click(screen.getByRole('button', { name: /scan card/i }))
    expect(await screen.findByText('0012345')).toBeInTheDocument()
    expect(capture.startCamera).toHaveBeenCalledTimes(1)
    await user.type(screen.getByLabelText('Store name'), 'Market')
    await user.click(screen.getByRole('button', { name: 'Save card' }))
    await screen.findByRole('button', { name: 'Market' })

    const [stored] = await makeRepository().list()
    expect(stored?.barcode).toEqual({ kind: 'generated', format: 'code128', value: '0012345' })
  })

  it('stops the camera when leaving the scanner', async () => {
    const stop = vi.fn()
    const capture = fakeCapture({ startCamera: vi.fn(async () => ({ stop })) })
    const { user } = renderApp(makeRepository(), capture)

    await user.click(await screen.findByRole('button', { name: /add card/i }))
    await user.click(screen.getByRole('button', { name: /scan card/i }))
    await screen.findByText(/looking for a barcode/i)
    await user.click(screen.getByRole('button', { name: 'Back' }))

    expect(stop).toHaveBeenCalled()
  })

  it('explains camera failures and offers the other capture methods', async () => {
    const capture = fakeCapture({
      startCamera: vi.fn(async () => {
        throw new Error('Camera access was denied.')
      }),
    })
    const { user } = renderApp(makeRepository(), capture)
    await user.click(await screen.findByRole('button', { name: /add card/i }))
    await user.click(screen.getByRole('button', { name: /scan card/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Camera access was denied.')
    await user.click(screen.getByRole('button', { name: 'Enter manually' }))
    expect(screen.getByLabelText('Barcode value')).toBeInTheDocument()
  })

  it('keeps scanning but explains what to try when nothing is detected for a while', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const camera = controllableCamera()
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<App repository={makeRepository()} capture={fakeCapture({ startCamera: camera.startCamera })} />)
    await user.click(await screen.findByRole('button', { name: /add card/i }))
    await user.click(screen.getByRole('button', { name: /scan card/i }))
    await screen.findByText(/looking for a barcode/i)
    expect(screen.queryByRole('button', { name: 'Scan again' })).not.toBeInTheDocument()

    act(() => camera.sessions[0]!.options!.onDiagnostics!(diagnostics()))
    await act(async () => {
      vi.advanceTimersByTime(8000)
    })

    expect(screen.getByText('No barcode detected yet.')).toBeInTheDocument()
    expect(screen.getByText(/15–25 cm/)).toBeInTheDocument()
    // Still scanning: the status line remains and the camera was not stopped.
    expect(screen.getByText(/looking for a barcode/i)).toBeInTheDocument()
    expect(camera.sessions[0]!.stop).not.toHaveBeenCalled()
    // Diagnostics show sizes and counts.
    expect(screen.getByText('Scan details')).toBeInTheDocument()
    expect(screen.getAllByText('1080 × 1920').length).toBeGreaterThan(0)

    // A late detection still works while the help is shown.
    act(() => camera.sessions[0]!.onResult({ status: 'decoded', format: 'upca', value: '012345678905' }))
    expect(await screen.findByText('012345678905')).toBeInTheDocument()
    expect(screen.getByText('UPC-A')).toBeInTheDocument()
  })

  it('restarts the camera on Scan again and stops the previous session', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const camera = controllableCamera()
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<App repository={makeRepository()} capture={fakeCapture({ startCamera: camera.startCamera })} />)
    await user.click(await screen.findByRole('button', { name: /add card/i }))
    await user.click(screen.getByRole('button', { name: /scan card/i }))
    await screen.findByText(/looking for a barcode/i)
    await act(async () => {
      vi.advanceTimersByTime(8000)
    })

    await user.click(screen.getByRole('button', { name: 'Scan again' }))
    await waitFor(() => expect(camera.startCamera).toHaveBeenCalledTimes(2))
    expect(camera.sessions[0]!.stop).toHaveBeenCalled()
    expect(screen.queryByText('No barcode detected yet.')).not.toBeInTheDocument()

    // The old session's late result is ignored; the new one's is used.
    act(() => camera.sessions[0]!.onResult({ status: 'decoded', format: 'code128', value: 'OLD-1' }))
    expect(screen.queryByText('OLD-1')).not.toBeInTheDocument()
    act(() => camera.sessions[1]!.onResult({ status: 'decoded', format: 'code128', value: 'NEW-2' }))
    expect(await screen.findByText('NEW-2')).toBeInTheDocument()
  })

  it('explains when the browser blocks reading camera pixels', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const camera = controllableCamera()
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<App repository={makeRepository()} capture={fakeCapture({ startCamera: camera.startCamera })} />)
    await user.click(await screen.findByRole('button', { name: /add card/i }))
    await user.click(screen.getByRole('button', { name: /scan card/i }))
    await screen.findByText(/looking for a barcode/i)
    act(() => camera.sessions[0]!.options!.onDiagnostics!(diagnostics({ framesDecoded: 0, blankFrames: 40 })))
    await act(async () => {
      vi.advanceTimersByTime(8000)
    })
    expect(screen.getByText(/isn’t letting the app read it/)).toBeInTheDocument()
  })

  it('reports a camera that stops by itself and offers to scan again', async () => {
    const camera = controllableCamera()
    const { user } = renderApp(makeRepository(), fakeCapture({ startCamera: camera.startCamera }))
    await user.click(await screen.findByRole('button', { name: /add card/i }))
    await user.click(screen.getByRole('button', { name: /scan card/i }))
    await screen.findByText(/looking for a barcode/i)
    const { CameraError } = await import('../features/barcodes/camera.ts')
    act(() => camera.sessions[0]!.options!.onError!(new CameraError('interrupted')))
    expect(await screen.findByRole('alert')).toHaveTextContent(/camera stopped/i)
    expect(screen.getByRole('button', { name: 'Scan again' })).toBeInTheDocument()
  })

  it('ignores camera callbacks that arrive after leaving the scanner', async () => {
    const camera = controllableCamera()
    const { user } = renderApp(makeRepository(), fakeCapture({ startCamera: camera.startCamera }))
    await user.click(await screen.findByRole('button', { name: /add card/i }))
    await user.click(screen.getByRole('button', { name: /scan card/i }))
    await screen.findByText(/looking for a barcode/i)
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(camera.sessions[0]!.stop).toHaveBeenCalled()

    act(() => {
      camera.sessions[0]!.options!.onDiagnostics!(diagnostics())
      camera.sessions[0]!.onResult({ status: 'decoded', format: 'code128', value: 'LATE-1' })
    })
    expect(screen.getByRole('heading', { name: 'Add a card' })).toBeInTheDocument()
    expect(screen.queryByText('LATE-1')).not.toBeInTheDocument()
  })

  it('handles a duplicate result from the camera only once', async () => {
    const camera = controllableCamera()
    const { user } = renderApp(makeRepository(), fakeCapture({ startCamera: camera.startCamera }))
    await user.click(await screen.findByRole('button', { name: /add card/i }))
    await user.click(screen.getByRole('button', { name: /scan card/i }))
    await screen.findByText(/looking for a barcode/i)
    act(() => {
      camera.sessions[0]!.onResult({ status: 'decoded', format: 'code39', value: '00ABC' })
      camera.sessions[0]!.onResult({ status: 'decoded', format: 'code39', value: '00ABC' })
    })
    expect(await screen.findByText('00ABC')).toBeInTheDocument()
    expect(screen.getAllByText('00ABC')).toHaveLength(1)
    expect(camera.sessions[0]!.stop).toHaveBeenCalledTimes(1)
  })

  it('imports an image that decodes automatically', async () => {
    const capture = fakeCapture({
      decodeImage: vi.fn(async (): Promise<DecodeResult> => ({ status: 'decoded', format: 'qrcode', value: 'MEMBER-0042' })),
    })
    const { user } = renderApp(makeRepository(), capture)
    await user.click(await screen.findByRole('button', { name: /add card/i }))
    await user.upload(screen.getByLabelText('Choose image'), new File(['img'], 'card.png', { type: 'image/png' }))

    // A decoded QR offers the redrawn code (default) or the original artwork.
    expect(await screen.findByText('Found a QR code.')).toBeInTheDocument()
    expect(screen.getByText('MEMBER-0042')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Use redrawn QR code' }))

    expect(await screen.findByRole('heading', { name: 'Check and name' })).toBeInTheDocument()
    expect(screen.getByText('MEMBER-0042')).toBeInTheDocument()
    expect(screen.getByText('QR code')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /captured barcode \(qr code\)/i })).toBeInTheDocument()
  })

  it('imports a 1D barcode straight to the details step without the artwork choice', async () => {
    const capture = fakeCapture({
      decodeImage: vi.fn(async (): Promise<DecodeResult> => ({ status: 'decoded', format: 'ean13', value: '4006381333931' })),
    })
    const { user } = renderApp(makeRepository(), capture)
    await user.click(await screen.findByRole('button', { name: /add card/i }))
    await user.upload(screen.getByLabelText('Choose image'), new File(['img'], 'card.png', { type: 'image/png' }))

    expect(await screen.findByRole('heading', { name: 'Check and name' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Keep original artwork' })).not.toBeInTheDocument()
  })

  it('keeps the original QR artwork as a cropped image with the exact decoded value', async () => {
    // jsdom Blobs can't be stored in IndexedDB (browsers' can); see repository tests.
    const NODE_BUFFER: string = 'node:buffer'
    const { Blob: NodeBlob } = (await import(/* @vite-ignore */ NODE_BUFFER)) as { Blob: typeof Blob }
    vi.stubGlobal('Blob', NodeBlob)
    const value = '  0000123 Gold  '
    const cropImage = vi.fn(async () => new NodeBlob(['png-bytes'], { type: 'image/png' }))
    const capture = fakeCapture({
      decodeImage: vi.fn(async (): Promise<DecodeResult> => ({ status: 'decoded', format: 'qrcode', value })),
      cropImage,
    })
    const { user } = renderApp(makeRepository(), capture)
    await user.click(await screen.findByRole('button', { name: /add card/i }))
    await user.upload(screen.getByLabelText('Choose image'), new File(['img'], 'logo-qr.png', { type: 'image/png' }))

    await user.click(await screen.findByRole('button', { name: 'Keep original artwork' }))
    // The existing cropper, preset to the square frame, with no retry needed.
    expect(screen.getByRole('slider', { name: 'Zoom' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Square' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save cropped image' }))

    expect(await screen.findByText(/original artwork, shown as-is/i)).toBeInTheDocument()
    expect(screen.queryByText(/couldn’t be redrawn/i)).not.toBeInTheDocument()
    await user.type(screen.getByLabelText('Store name'), 'Logo Shop')
    await user.click(screen.getByRole('button', { name: 'Save card' }))
    await screen.findByRole('button', { name: 'Logo Shop' })

    const [stored] = await makeRepository().list()
    expect(stored?.barcode).toMatchObject({ kind: 'image', detectedFormat: 'QR code', detectedValue: value })
    expect(cropImage).toHaveBeenCalledTimes(1)
  })

  it('can return from the artwork cropper to the redrawn QR code', async () => {
    const capture = fakeCapture({
      decodeImage: vi.fn(async (): Promise<DecodeResult> => ({ status: 'decoded', format: 'qrcode', value: 'MEMBER-7' })),
    })
    const { user } = renderApp(makeRepository(), capture)
    await user.click(await screen.findByRole('button', { name: /add card/i }))
    await user.upload(screen.getByLabelText('Choose image'), new File(['img'], 'card.png', { type: 'image/png' }))
    await user.click(await screen.findByRole('button', { name: 'Keep original artwork' }))
    await user.click(screen.getByRole('button', { name: 'Use redrawn QR code' }))

    expect(await screen.findByRole('img', { name: /captured barcode \(qr code\)/i })).toBeInTheDocument()
    expect(screen.getByText('MEMBER-7')).toBeInTheDocument()
  })

  it('offers crop-and-retry when an imported image has no readable barcode, and succeeds on retry', async () => {
    const decodeImage = vi
      .fn<CaptureServices['decodeImage']>()
      .mockResolvedValueOnce({ status: 'not-found' })
      .mockResolvedValueOnce({ status: 'decoded', format: 'ean13', value: '4006381333931' })
    const { user } = renderApp(makeRepository(), fakeCapture({ decodeImage }))
    await user.click(await screen.findByRole('button', { name: /add card/i }))
    await user.upload(screen.getByLabelText('Choose image'), new File(['img'], 'shot.png', { type: 'image/png' }))

    expect(await screen.findByText(/no barcode was found/i)).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: 'Zoom' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Square' }))
    expect(screen.getByRole('button', { name: 'Square' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByText('4006381333931')).toBeInTheDocument()
    // The retry decoded a cropped region.
    expect(decodeImage.mock.calls[1]?.[1]).toEqual({ x: 0, y: 0, width: 400, height: 200 })
  })

  it('saves a cropped-image fallback when the barcode still cannot be read', async () => {
    // jsdom Blobs can't be stored in IndexedDB (browsers' can); see repository tests.
    const NODE_BUFFER: string = 'node:buffer'
    const { Blob: NodeBlob } = (await import(/* @vite-ignore */ NODE_BUFFER)) as { Blob: typeof Blob }
    vi.stubGlobal('Blob', NodeBlob)
    const capture = fakeCapture({ cropImage: vi.fn(async () => new NodeBlob(['png-bytes'], { type: 'image/png' })) })
    const { user } = renderApp(makeRepository(), capture)
    await user.click(await screen.findByRole('button', { name: /add card/i }))
    await user.upload(screen.getByLabelText('Choose image'), new File(['img'], 'shot.png', { type: 'image/png' }))
    await screen.findByText(/no barcode was found/i)
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText(/still no barcode/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Save cropped image' }))
    expect(await screen.findByText(/saved as an image/i)).toBeInTheDocument()
    await user.type(screen.getByLabelText('Store name'), 'Odd Shop')
    await user.click(screen.getByRole('button', { name: 'Save card' }))
    await screen.findByRole('button', { name: 'Odd Shop' })

    const [stored] = await makeRepository().list()
    expect(stored?.barcode.kind).toBe('image')
  })

  it('explains an unsupported symbology instead of substituting another format', async () => {
    const capture = fakeCapture({
      decodeImage: vi.fn(async (): Promise<DecodeResult> => ({ status: 'unsupported', formatLabel: 'Codabar', value: 'A1234B' })),
    })
    const { user } = renderApp(makeRepository(), capture)
    await user.click(await screen.findByRole('button', { name: /add card/i }))
    await user.upload(screen.getByLabelText('Choose image'), new File(['img'], 'shot.png', { type: 'image/png' }))

    expect(await screen.findByText(/found a codabar barcode, which this app can’t redraw/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save cropped image' })).toBeInTheDocument()
  })

  it('reports an image that cannot be opened', async () => {
    const capture = fakeCapture({
      loadImage: vi.fn(async () => {
        throw new Error('That file couldn’t be opened as an image.')
      }),
    })
    const { user } = renderApp(makeRepository(), capture)
    await user.click(await screen.findByRole('button', { name: /add card/i }))
    await user.upload(screen.getByLabelText('Choose image'), new File(['x'], 'bad.png', { type: 'image/png' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('couldn’t be opened')
    expect(screen.getByRole('button', { name: 'Choose another image' })).toBeInTheDocument()
  })

  it('opens a card full screen on tap and closes it with the X, returning focus to the tile', async () => {
    const { user } = renderApp()
    await addManualCard(user, 'Corner Coffee', '0012')

    await user.click(screen.getByRole('button', { name: 'Corner Coffee' }))

    const checkout = screen.getByRole('dialog', { name: 'Corner Coffee' })
    expect(within(checkout).getByRole('img', { name: /corner coffee barcode \(code 128\)/i })).toBeInTheDocument()
    expect(screen.queryByRole('banner')).not.toBeInTheDocument()
    expect(document.documentElement).toHaveClass('checkout-open')

    await user.click(screen.getByRole('button', { name: 'Close card' }))
    expect(document.documentElement).not.toHaveClass('checkout-open')
    expect(screen.getByRole('button', { name: 'Corner Coffee' })).toHaveFocus()
  })

  it('switches cards by swiping and with the arrow keys, stopping at the ends', async () => {
    const { user } = renderApp()
    await addManualCard(user, 'First', '1')
    await addManualCard(user, 'Second', '2')
    await user.click(screen.getByRole('button', { name: 'First' }))

    const stage = screen.getByTestId('checkout-stage')
    fireEvent.pointerDown(stage, { pointerId: 1, isPrimary: true, clientX: 300, clientY: 200 })
    fireEvent.pointerMove(stage, { pointerId: 1, clientX: 180, clientY: 205 })
    fireEvent.pointerUp(stage, { pointerId: 1, clientX: 180, clientY: 205 })
    expect(screen.getByRole('dialog', { name: 'Second' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Second, card 2 of 2')

    // A short drag snaps back.
    fireEvent.pointerDown(stage, { pointerId: 2, isPrimary: true, clientX: 200, clientY: 200 })
    fireEvent.pointerUp(stage, { pointerId: 2, clientX: 230, clientY: 200 })
    expect(screen.getByRole('dialog', { name: 'Second' })).toBeInTheDocument()

    // No wrap-around at the end.
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('dialog', { name: 'Second' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next card' })).toBeDisabled()

    await user.keyboard('{ArrowLeft}')
    expect(screen.getByRole('dialog', { name: 'First' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.getByRole('button', { name: 'First' })).toHaveFocus()
  })

  it('shows M8TRX at the top, the name immediately above the card, and pagination below the stage', async () => {
    const { user } = renderApp()
    await addManualCard(user, 'Corner Coffee', '0012', 'Code 128', 'Green')
    await addManualCard(user, 'Second', '2')
    await user.click(screen.getByRole('button', { name: 'Corner Coffee' }))

    const checkout = screen.getByRole('dialog', { name: 'Corner Coffee' })
    // Top bar: decorative M8TRX title (hidden from assistive tech) and the ×.
    const header = screen.getByTestId('checkout-header')
    const brand = within(header).getByTestId('checkout-brand')
    expect(brand).toHaveTextContent('M8TRX')
    expect(brand).toHaveAttribute('aria-hidden', 'true')
    expect(within(header).getByRole('button', { name: 'Close card' })).toBeInTheDocument()
    expect(within(header).queryByRole('heading')).not.toBeInTheDocument()

    // The name is the card's caption: in the stage, the face's immediate predecessor.
    const stage = screen.getByTestId('checkout-stage')
    const face = within(stage).getByTestId('checkout-card')
    const heading = within(stage).getByRole('heading', { level: 1, name: 'Corner Coffee' })
    expect(heading.nextElementSibling).toBe(face)
    expect(within(face).getByRole('img', { name: /code 128/i })).toBeInTheDocument()
    // A linear code keeps the compact credit-card face.
    expect(face).toHaveAttribute('data-presentation', 'card')

    // Pagination is alone in the bottom region, after the stage.
    const info = screen.getByTestId('checkout-info')
    expect(within(info).getByRole('button', { name: 'Next card' })).toBeInTheDocument()
    expect(within(info).queryByRole('heading')).not.toBeInTheDocument()
    expect(stage.nextElementSibling).toBe(info)

    // Document order: M8TRX, then the name, then the card, then pagination.
    const follows = (a: Node, b: Node) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
    expect(follows(brand, heading)).toBe(true)
    expect(follows(heading, face)).toBe(true)
    expect(follows(face, info)).toBe(true)

    // The accent is local to the card face, not the whole screen.
    expect(face.style.getPropertyValue('--card-accent')).toBe('#2e7d32')
    expect(checkout.style.getPropertyValue('--card-accent')).toBe('')
  })

  it('shows the store name above the card even without pagination (single card)', async () => {
    const { user } = renderApp()
    await addManualCard(user, 'Only', '1')
    await user.click(screen.getByRole('button', { name: 'Only' }))

    const heading = within(screen.getByTestId('checkout-stage')).getByRole('heading', { level: 1, name: 'Only' })
    expect(heading.nextElementSibling).toBe(screen.getByTestId('checkout-card'))
    expect(screen.queryByRole('button', { name: 'Next card' })).not.toBeInTheDocument()
  })

  it('gives a redrawn QR code the square checkout face', async () => {
    const { user } = renderApp()
    await addManualCard(user, 'Gym Pass', 'MEMBER-42', 'QR code')
    await user.click(screen.getByRole('button', { name: 'Gym Pass' }))

    const face = screen.getByTestId('checkout-card')
    expect(face).toHaveAttribute('data-presentation', 'square')
    expect(within(face).getByRole('img', { name: /gym pass barcode \(qr code\)/i })).toBeInTheDocument()
  })

  it('keeps the active card accent on the card face across swipes and never writes accent colours to <html>', async () => {
    const { user } = renderApp()
    await addManualCard(user, 'Slate Shop', '1', 'Code 128', 'Slate')
    await addManualCard(user, 'Red Shop', '2', 'Code 128', 'Red')
    const root = document.documentElement
    const swipe = (id: number, dx: number) => {
      const stage = screen.getByTestId('checkout-stage')
      fireEvent.pointerDown(stage, { pointerId: id, isPrimary: true, clientX: 200, clientY: 200 })
      fireEvent.pointerMove(stage, { pointerId: id, clientX: 200 + dx, clientY: 202 })
      fireEvent.pointerUp(stage, { pointerId: id, clientX: 200 + dx, clientY: 202 })
    }
    const expectActive = (name: string, accent: string) => {
      expect(screen.getByRole('dialog', { name })).toBeInTheDocument()
      expect(screen.getByTestId('checkout-card').style.getPropertyValue('--card-accent')).toBe(accent)
      // The outer surface no longer depends on the active card (v0.4.1).
      expect(root.getAttribute('style') ?? '').not.toMatch(/accent/)
    }

    await user.click(screen.getByRole('button', { name: 'Slate Shop' }))
    expect(root).toHaveClass('checkout-open')
    expectActive('Slate Shop', '#455a64')
    const close = screen.getByRole('button', { name: 'Close card' })
    expect(close).toHaveFocus()

    for (let round = 0; round < 3; round++) {
      swipe(round * 2 + 1, -150)
      expectActive('Red Shop', '#c62828')
      swipe(round * 2 + 2, 150)
      expectActive('Slate Shop', '#455a64')
    }
    await user.keyboard('{ArrowRight}')
    expectActive('Red Shop', '#c62828')
    // Switching cards does not steal focus back to the × (it stays where it was).
    expect(close).toHaveFocus()

    await user.click(screen.getByRole('button', { name: 'Close card' }))
    expect(root).not.toHaveClass('checkout-open')
    expect(screen.getByRole('button', { name: 'Red Shop' })).toHaveFocus()
  })

  it('closes checkout with a deliberate downward swipe and returns focus to the tile', async () => {
    const { user } = renderApp()
    await addManualCard(user, 'First', '1')
    await addManualCard(user, 'Second', '2')
    await user.click(screen.getByRole('button', { name: 'Second' }))

    const stage = screen.getByTestId('checkout-stage')
    fireEvent.pointerDown(stage, { pointerId: 1, isPrimary: true, clientX: 200, clientY: 200 })
    fireEvent.pointerMove(stage, { pointerId: 1, clientX: 205, clientY: 260 })
    fireEvent.pointerMove(stage, { pointerId: 1, clientX: 210, clientY: 360 })
    fireEvent.pointerUp(stage, { pointerId: 1, clientX: 210, clientY: 360 })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(document.documentElement).not.toHaveClass('checkout-open')
    expect(screen.getByRole('button', { name: 'Second' })).toHaveFocus()
  })

  it('does not close for taps, short, diagonal, upward, horizontal or cancelled gestures', async () => {
    const { user } = renderApp()
    await addManualCard(user, 'First', '1')
    await addManualCard(user, 'Second', '2')
    await user.click(screen.getByRole('button', { name: 'First' }))
    const stage = screen.getByTestId('checkout-stage')
    const gesture = (id: number, to: { x: number; y: number }, cancel = false) => {
      fireEvent.pointerDown(stage, { pointerId: id, isPrimary: true, clientX: 200, clientY: 200 })
      fireEvent.pointerMove(stage, { pointerId: id, clientX: 200 + to.x / 2, clientY: 200 + to.y / 2 })
      fireEvent.pointerMove(stage, { pointerId: id, clientX: 200 + to.x, clientY: 200 + to.y })
      if (cancel) fireEvent.pointerCancel(stage, { pointerId: id, clientX: 200 + to.x, clientY: 200 + to.y })
      else fireEvent.pointerUp(stage, { pointerId: id, clientX: 200 + to.x, clientY: 200 + to.y })
    }

    gesture(1, { x: 0, y: 0 }) // tap
    gesture(2, { x: 3, y: 8 }) // jitter inside the dead zone
    gesture(3, { x: 0, y: 70 }) // short downward drag
    gesture(4, { x: 110, y: 130 }) // diagonal
    gesture(5, { x: 0, y: -200 }) // upward
    gesture(6, { x: 0, y: 220 }, true) // cancelled by the browser
    expect(screen.getByRole('dialog', { name: 'First' })).toBeInTheDocument()

    // A horizontal swipe with some downward drift switches cards and does not close.
    gesture(7, { x: -150, y: 40 })
    expect(screen.getByRole('dialog', { name: 'Second' })).toBeInTheDocument()
    // A horizontal swipe that turns downward late is still horizontal (axis lock).
    fireEvent.pointerDown(stage, { pointerId: 8, isPrimary: true, clientX: 300, clientY: 200 })
    fireEvent.pointerMove(stage, { pointerId: 8, clientX: 270, clientY: 202 })
    fireEvent.pointerUp(stage, { pointerId: 8, clientX: 280, clientY: 400 })
    expect(screen.getByRole('dialog', { name: 'Second' })).toBeInTheDocument()
  })

  it('requests a screen wake lock in checkout and releases it on close', async () => {
    const release = vi.fn(async () => {})
    const request = vi.fn(async () => ({ release }))
    vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { wakeLock: { request } }))
    const { user } = renderApp()
    await addManualCard(user, 'Shop', '1')

    await user.click(screen.getByRole('button', { name: 'Shop' }))
    await waitFor(() => expect(request).toHaveBeenCalledWith('screen'))
    await user.click(screen.getByRole('button', { name: 'Close card' }))
    await waitFor(() => expect(release).toHaveBeenCalled())
  })

  it('still shows the card when the wake lock is refused', async () => {
    const request = vi.fn(async () => {
      throw new DOMException('no', 'NotAllowedError')
    })
    vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { wakeLock: { request } }))
    const { user } = renderApp()
    await addManualCard(user, 'Shop', '1')

    await user.click(screen.getByRole('button', { name: 'Shop' }))
    await waitFor(() => expect(request).toHaveBeenCalled())
    expect(screen.getByRole('img', { name: /shop barcode/i })).toBeInTheDocument()
  })

  it('rearranges cards with a touch long-press and drag, and keeps the order after a restart', async () => {
    const first = renderApp()
    await addManualCard(first.user, 'A', '1')
    await addManualCard(first.user, 'B', '2')
    await addManualCard(first.user, 'C', '3')
    layoutWallet()

    touchDrag('C', 2, 0)

    expect(tileOrder()).toEqual(['C', 'A', 'B'])
    // Neither the card nor its management menu opened.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(await screen.findByText('C moved to position 1 of 3.')).toBeInTheDocument()
    await waitFor(async () => expect((await makeRepository().list()).map((card) => card.storeName)).toEqual(['C', 'A', 'B']))
    first.unmount()

    // Restart: same database, new repository and app instance.
    const second = renderApp()
    await screen.findByRole('button', { name: 'C' })
    expect(tileOrder()).toEqual(['C', 'A', 'B'])
    // The saved order is also checkout's left/right sequence.
    await second.user.click(screen.getByRole('button', { name: 'C' }))
    await second.user.keyboard('{ArrowRight}')
    expect(screen.getByRole('dialog', { name: 'A' })).toBeInTheDocument()
  })

  it('rearranges cards with a mouse drag without opening the card', async () => {
    const { user } = renderApp()
    await addManualCard(user, 'A', '1')
    await addManualCard(user, 'B', '2')
    await addManualCard(user, 'C', '3')
    layoutWallet()
    const tile = screen.getByRole('button', { name: 'A' })

    fireEvent.pointerDown(tile, { pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, ...centre(0) })
    fireEvent.pointerMove(tile, { pointerId: 1, pointerType: 'mouse', clientX: 60, clientY: 55 })
    expect(tile.closest('li')).toHaveClass('tile--dragging')
    fireEvent.pointerMove(tile, { pointerId: 1, pointerType: 'mouse', ...centre(1) })
    expect(tileOrder()).toEqual(['B', 'A', 'C'])
    fireEvent.pointerUp(tile, { pointerId: 1, pointerType: 'mouse', ...centre(1) })
    fireEvent.click(tile)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(tile.closest('li')).not.toHaveClass('tile--dragging')
    await waitFor(async () => expect((await makeRepository().list()).map((card) => card.storeName)).toEqual(['B', 'A', 'C']))
  })

  it('still opens the card on a short touch, a click that barely moves, Enter and Space', async () => {
    const { user } = renderApp()
    await addManualCard(user, 'Shop', '1')
    layoutWallet()
    const close = async () => {
      await user.click(screen.getByRole('button', { name: 'Close card' }))
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    }

    // Short touch: released before the long-press delay.
    fakeLongPressTimer()
    const tile = screen.getByRole('button', { name: 'Shop' })
    fireEvent.pointerDown(tile, { pointerId: 1, pointerType: 'touch', isPrimary: true, button: 0, ...centre(0) })
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS / 2)
    })
    fireEvent.pointerUp(tile, { pointerId: 1, pointerType: 'touch', ...centre(0) })
    fireEvent.click(tile)
    vi.useRealTimers()
    expect(screen.getByRole('dialog', { name: 'Shop' })).toBeInTheDocument()
    await close()

    // Mouse click with a few pixels of jitter (below the drag threshold).
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Shop' }), { pointerId: 2, pointerType: 'mouse', isPrimary: true, button: 0, ...centre(0) })
    fireEvent.pointerMove(screen.getByRole('button', { name: 'Shop' }), { pointerId: 2, pointerType: 'mouse', clientX: 52, clientY: 52 })
    fireEvent.pointerUp(screen.getByRole('button', { name: 'Shop' }), { pointerId: 2, pointerType: 'mouse', clientX: 52, clientY: 52 })
    fireEvent.click(screen.getByRole('button', { name: 'Shop' }))
    expect(screen.getByRole('dialog', { name: 'Shop' })).toBeInTheDocument()
    await close()

    screen.getByRole('button', { name: 'Shop' }).focus()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('dialog', { name: 'Shop' })).toBeInTheDocument()
    await close()

    screen.getByRole('button', { name: 'Shop' }).focus()
    await user.keyboard(' ')
    expect(screen.getByRole('dialog', { name: 'Shop' })).toBeInTheDocument()
  })

  it('treats finger movement before the long-press delay as scrolling, not a drag', async () => {
    const { user } = renderApp()
    await addManualCard(user, 'A', '1')
    await addManualCard(user, 'B', '2')
    layoutWallet()
    const tile = screen.getByRole('button', { name: 'A' })

    fakeLongPressTimer()
    fireEvent.pointerDown(tile, { pointerId: 1, pointerType: 'touch', isPrimary: true, button: 0, ...centre(0) })
    fireEvent.pointerMove(tile, { pointerId: 1, pointerType: 'touch', clientX: 50, clientY: 80 })
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS * 2)
    })
    vi.useRealTimers()
    fireEvent.pointerMove(tile, { pointerId: 1, pointerType: 'touch', ...centre(1) })
    fireEvent.pointerCancel(tile, { pointerId: 1, pointerType: 'touch' })

    expect(tile.closest('li')).not.toHaveClass('tile--dragging')
    expect(tileOrder()).toEqual(['A', 'B'])
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('a long press without movement opens neither the menu nor the card', async () => {
    const { user } = renderApp()
    await addManualCard(user, 'Shop', '1')
    layoutWallet()
    touchDrag('Shop', 0, 0)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(tileOrder()).toEqual(['Shop'])
    // The ⋯ button remains the way into the menu.
    await user.click(screen.getByRole('button', { name: 'Options for Shop' }))
    expect(screen.getByRole('dialog', { name: 'Shop' })).toBeInTheDocument()
  })

  it('reverts a drag that is cancelled by the browser or with Escape, saving nothing', async () => {
    const { user } = renderApp()
    await addManualCard(user, 'A', '1')
    await addManualCard(user, 'B', '2')
    layoutWallet()
    const tile = screen.getByRole('button', { name: 'A' })
    const startDrag = (pointerId: number) => {
      fireEvent.pointerDown(tile, { pointerId, pointerType: 'mouse', isPrimary: true, button: 0, ...centre(0) })
      fireEvent.pointerMove(tile, { pointerId, pointerType: 'mouse', clientX: 60, clientY: 60 })
      fireEvent.pointerMove(tile, { pointerId, pointerType: 'mouse', ...centre(1) })
      expect(tileOrder()).toEqual(['B', 'A'])
    }

    startDrag(1)
    fireEvent.pointerCancel(tile, { pointerId: 1, pointerType: 'mouse' })
    expect(tileOrder()).toEqual(['A', 'B'])

    startDrag(2)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(tileOrder()).toEqual(['A', 'B'])
    fireEvent.pointerUp(tile, { pointerId: 2, pointerType: 'mouse', ...centre(1) })
    fireEvent.click(tile)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect((await makeRepository().list()).map((card) => card.storeName)).toEqual(['A', 'B'])
  })

  it('restores the previous order when saving a drag fails', async () => {
    const real = makeRepository()
    const failing: CardRepository = { ...real, reorder: vi.fn(async () => Promise.reject(new Error('Couldn’t save the new card order.'))) }
    const { user } = renderApp(failing)
    await addManualCard(user, 'A', '1')
    await addManualCard(user, 'B', '2')
    layoutWallet()

    touchDrag('A', 0, 1)

    await waitFor(() => expect(tileOrder()).toEqual(['A', 'B']))
    expect(await screen.findByText('Couldn’t save the new card order.')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('moves cards from the options menu with the keyboard and announces the new position', async () => {
    const { user } = renderApp()
    await addManualCard(user, 'A', '1')
    await addManualCard(user, 'B', '2')
    await addManualCard(user, 'C', '3')

    // Boundaries: the first card can't move earlier.
    await user.click(screen.getByRole('button', { name: 'Options for A' }))
    expect(screen.getByRole('group', { name: 'Position 1 of 3' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Move earlier' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Move to first' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Move later' })).toBeEnabled()
    await user.keyboard('{Escape}')

    screen.getByRole('button', { name: 'Options for C' }).focus()
    await user.keyboard('{Enter}')
    screen.getByRole('button', { name: 'Move to first' }).focus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(tileOrder()).toEqual(['C', 'A', 'B']))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByText('C moved to position 1 of 3.')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'C' })).toHaveFocus())

    await user.click(screen.getByRole('button', { name: 'Options for C' }))
    await user.click(screen.getByRole('button', { name: 'Move later' }))
    await waitFor(() => expect(tileOrder()).toEqual(['A', 'C', 'B']))
    await user.click(screen.getByRole('button', { name: 'Options for A' }))
    await user.click(screen.getByRole('button', { name: 'Move to last' }))
    await waitFor(() => expect(tileOrder()).toEqual(['C', 'B', 'A']))
    await user.click(screen.getByRole('button', { name: 'Options for B' }))
    await user.click(screen.getByRole('button', { name: 'Move earlier' }))
    await waitFor(() => expect(tileOrder()).toEqual(['B', 'C', 'A']))
    expect((await makeRepository().list()).map((card) => card.storeName)).toEqual(['B', 'C', 'A'])
  })

  it('keeps the menu open with a message when a keyboard move fails to save', async () => {
    const real = makeRepository()
    const failing: CardRepository = { ...real, reorder: vi.fn(async () => Promise.reject(new Error('Couldn’t save the new card order.'))) }
    const { user } = renderApp(failing)
    await addManualCard(user, 'A', '1')
    await addManualCard(user, 'B', '2')

    await user.click(screen.getByRole('button', { name: 'Options for B' }))
    await user.click(screen.getByRole('button', { name: 'Move to first' }))

    const menu = screen.getByRole('dialog', { name: 'B' })
    expect(await within(menu).findByRole('alert')).toHaveTextContent('Couldn’t save the new card order.')
    expect(tileOrder()).toEqual(['A', 'B'])
    expect((await real.list()).map((card) => card.storeName)).toEqual(['A', 'B'])
  })

  it('renames and recolours a card from the keyboard-accessible options button', async () => {
    const { user } = renderApp()
    await addManualCard(user, 'Shop', '1', 'Code 128', 'Red')

    await user.click(screen.getByRole('button', { name: 'Options for Shop' }))
    await user.click(screen.getByRole('button', { name: 'Rename' }))
    const input = screen.getByLabelText('Store name')
    expect(input).toHaveFocus()
    await user.clear(input)
    await user.type(input, 'Better Shop{Enter}')
    expect(await screen.findByRole('button', { name: 'Better Shop' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Options for Better Shop' }))
    await user.click(screen.getByRole('button', { name: 'Change colour' }))
    await user.click(screen.getByRole('radio', { name: 'Purple' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Better Shop' }).closest('li')).toHaveStyle({ background: '#7b1fa2' }))
    expect(screen.getByRole('button', { name: 'Options for Better Shop' })).toHaveFocus()

    // Survives a restart.
    const [stored] = await makeRepository().list()
    expect(stored).toMatchObject({ storeName: 'Better Shop', color: 'purple' })
  })

  it('closes the menu with Escape and keeps the card when deletion is cancelled', async () => {
    const { user } = renderApp()
    await addManualCard(user, 'Shop', '1')

    await user.click(screen.getByRole('button', { name: 'Options for Shop' }))
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Options for Shop' }))
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('button', { name: 'Shop' })).toBeInTheDocument()
  })

  it('deletes a card after confirmation', async () => {
    const { user } = renderApp()
    await addManualCard(user, 'Keep', '1')
    await addManualCard(user, 'Remove', '2')

    await user.click(screen.getByRole('button', { name: 'Options for Remove' }))
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await user.click(screen.getByRole('button', { name: 'Delete card' }))

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Keep' })).toBeInTheDocument()
    expect(screen.getByText('Card deleted.')).toBeInTheDocument()
    await expect(makeRepository().list()).resolves.toHaveLength(1)
  })

  it('keeps cards after closing and reopening the app', async () => {
    const first = renderApp()
    await addManualCard(first.user, 'Corner Coffee', '0012')
    first.unmount()

    renderApp()
    expect(await screen.findByRole('button', { name: 'Corner Coffee' })).toBeInTheDocument()
  })

  it('shows a load error with a working retry', async () => {
    let fail = true
    const real = makeRepository()
    const flaky: CardRepository = {
      ...real,
      list: () => (fail ? Promise.reject(new Error('Couldn’t load your cards.')) : real.list()),
    }
    const { user } = renderApp(flaky)

    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load your cards.')
    fail = false
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { name: 'No cards yet' })).toBeInTheDocument()
  })

  it('keeps the entered details when saving fails', async () => {
    const real = makeRepository()
    const failing: CardRepository = { ...real, create: () => Promise.reject(new Error('Couldn’t save the card.')) }
    const { user } = renderApp(failing)
    await user.click(await screen.findByRole('button', { name: /add card/i }))
    await user.click(screen.getByRole('button', { name: /enter manually/i }))
    await user.type(screen.getByLabelText('Barcode value'), '42')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.type(await screen.findByLabelText('Store name'), 'Shop')
    await user.click(screen.getByRole('button', { name: 'Save card' }))

    expect(await screen.findByText('Couldn’t save the card.')).toBeInTheDocument()
    expect(screen.getByLabelText('Store name')).toHaveValue('Shop')
  })

  it('shows a migrated card without a barcode format as its number, never as a guessed barcode', async () => {
    await new Promise<void>((resolve, reject) => {
      const request = factory.open('dim8-loyalty-card', 1)
      request.onupgradeneeded = () => {
        request.result.createObjectStore('cards', { keyPath: 'id' }).add({
          id: 'old',
          storeName: 'Old Card',
          cardNumber: '000123',
          notes: 'secret note',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        })
      }
      request.onsuccess = () => {
        request.result.close()
        resolve()
      }
      request.onerror = () => reject(request.error)
    })
    const { user } = renderApp()

    const tile = await screen.findByRole('button', { name: 'Old Card' })
    expect(tile.querySelector('[data-preview="text"]')).toBeInTheDocument()
    await user.click(tile)
    expect(screen.getByText('000123')).toBeInTheDocument()
    expect(screen.getByText(/no barcode saved/i)).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.queryByText('secret note')).not.toBeInTheDocument()
  })

  it('supports the full add → open → close flow from the keyboard', async () => {
    const { user } = renderApp()
    await screen.findByRole('heading', { name: 'No cards yet' })

    await user.tab()
    expect(screen.getByRole('button', { name: /add card/i })).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('heading', { level: 1, name: 'Add a card' })).toHaveFocus()
    await user.click(screen.getByRole('button', { name: /enter manually/i }))
    expect(screen.getByRole('heading', { level: 1, name: 'Enter manually' })).toHaveFocus()
    await user.tab() // format (Back sits before the heading)
    expect(screen.getByLabelText('Barcode format')).toHaveFocus()
    await user.tab() // value
    await user.keyboard('ABC{Enter}')
    expect(await screen.findByRole('heading', { level: 1, name: 'Check and name' })).toHaveFocus()
    await user.click(screen.getByLabelText('Store name'))
    await user.keyboard('Shop{Enter}')

    const tile = await screen.findByRole('button', { name: 'Shop' })
    expect(tile).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('button', { name: 'Close card' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.getByRole('button', { name: 'Shop' })).toHaveFocus()
  })
})
