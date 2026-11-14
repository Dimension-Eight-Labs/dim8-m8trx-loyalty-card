/**
 * Live-scan tests.
 *
 * Part 1 drives the DOM-free scan loop with a manual scheduler and fake frame
 * sources: frame readiness, per-frame failures, continued scheduling, stop
 * idempotence, confirmation and exactly-once delivery.
 *
 * Part 2 drives the real camera adapter (startCameraScan) in jsdom with a
 * fake MediaStream, a fake <video> state, and a small fake 2D canvas that
 * samples a synthetic "camera scene" containing a real Code 128 symbol on a
 * card against a darker surround. (The unpatched-ZXing regression itself is
 * pinned in barcodes.test.ts, where it is verified to fail without the patch.)
 *
 * Host tests only: they prove the control flow and the decoder on synthetic
 * pixels, not that a particular iPhone camera/browser delivers readable frames.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CameraError, startCameraScan, type ScanDiagnostics } from './camera.ts'
import { resetCanvasProbe } from './canvasProbe.ts'
import { decodeBitmap, PRIORITY_FORMATS, type DecodeResult } from './decode.ts'
import { createBitmapDrawing, type GreyBitmap } from './rasterize.ts'
import { renderWith } from './render.ts'
import {
  FrameError,
  guideRegion,
  LIVE_VARIANTS,
  MAX_TICK_GAP_MS,
  MIN_TICK_GAP_MS,
  startScanLoop,
  type GrabResult,
  type LoopStats,
  type ScanLoopDeps,
} from './scanLoop.ts'

// ─── Helpers ────────────────────────────────────────────────────────────────

function manualScheduler() {
  const queue: Array<{ callback: () => void; delay: number; cancelled: boolean }> = []
  return {
    schedule(callback: () => void, delay: number) {
      const entry = { callback, delay, cancelled: false }
      queue.push(entry)
      return () => {
        entry.cancelled = true
      }
    },
    /** Runs the next live scheduled tick; returns false if none. */
    runNext(): boolean {
      while (queue.length > 0) {
        const entry = queue.shift()!
        if (!entry.cancelled) {
          entry.callback()
          return true
        }
      }
      return false
    },
    pending: () => queue.filter((entry) => !entry.cancelled).length,
    lastDelay: () => queue.at(-1)?.delay,
  }
}

const textured = (width = 64, height = 48): GreyBitmap => {
  const data = new Uint8ClampedArray(width * height)
  for (let i = 0; i < data.length; i++) data[i] = (i * 37) % 256
  return { width, height, data }
}

const okFrame = (bitmap: GreyBitmap = textured()): GrabResult => ({ status: 'ok', bitmap, frameWidth: 1080, frameHeight: 1920 })

function makeLoop(overrides: Partial<ScanLoopDeps> = {}) {
  const scheduler = manualScheduler()
  let clock = 0
  const onResult = vi.fn()
  const onStats = vi.fn<(stats: LoopStats) => void>()
  const deps: ScanLoopDeps = {
    grab: vi.fn(() => okFrame()),
    decode: vi.fn((): DecodeResult => ({ status: 'not-found' })),
    schedule: scheduler.schedule,
    now: () => (clock += 10),
    onResult,
    onStats,
    ...overrides,
  }
  const loop = startScanLoop(deps)
  return { loop, scheduler, deps, onResult, onStats }
}

// ─── Part 1: scan loop ──────────────────────────────────────────────────────

describe('scan loop', () => {
  it('skips frames that are not ready (zero-sized video) and keeps scheduling', () => {
    const { loop, scheduler, deps } = makeLoop({ grab: vi.fn((): GrabResult => ({ status: 'not-ready' })) })
    for (let i = 0; i < 5; i++) expect(scheduler.runNext()).toBe(true)
    expect(deps.decode).not.toHaveBeenCalled()
    expect(loop.stats().framesNotReady).toBe(5)
    expect(scheduler.pending()).toBe(1)
  })

  it('counts blank frames without decoding them', () => {
    const blank = { width: 32, height: 32, data: new Uint8ClampedArray(32 * 32).fill(17) }
    const { loop, scheduler, deps } = makeLoop({ grab: vi.fn(() => okFrame(blank)) })
    scheduler.runNext()
    scheduler.runNext()
    expect(deps.decode).not.toHaveBeenCalled()
    expect(loop.stats().blankFrames).toBe(2)
    expect(scheduler.pending()).toBe(1)
  })

  it('records frame-capture errors by category and keeps scanning', () => {
    let call = 0
    const grab = vi.fn((): GrabResult => {
      call += 1
      if (call === 1) throw new FrameError('canvas-unavailable')
      if (call === 2) throw new TypeError('drawImage failed')
      return okFrame()
    })
    const { loop, scheduler, deps } = makeLoop({ grab })
    scheduler.runNext()
    expect(loop.stats().lastErrorCategory).toBe('canvas-unavailable')
    scheduler.runNext()
    expect(loop.stats().lastErrorCategory).toBe('frame-capture')
    scheduler.runNext()
    expect(loop.stats().frameErrors).toBe(2)
    expect(deps.decode).toHaveBeenCalledTimes(1)
    expect(scheduler.pending()).toBe(1)
  })

  it('survives thrown and reported decoder errors', () => {
    let call = 0
    const decode = vi.fn((): DecodeResult => {
      call += 1
      if (call === 1) throw new RangeError('decoder exploded')
      return { status: 'not-found', reason: 'decoder-error' }
    })
    const { loop, scheduler } = makeLoop({ decode })
    scheduler.runNext()
    scheduler.runNext()
    expect(loop.stats()).toMatchObject({ decoderErrors: 2, misses: 2, lastErrorCategory: 'decoder' })
    expect(scheduler.pending()).toBe(1)
  })

  it('keeps scanning through repeated misses, cycling through frame variants', () => {
    const { loop, scheduler, deps } = makeLoop()
    for (let i = 0; i < LIVE_VARIANTS.length * 2; i++) scheduler.runNext()
    expect(loop.stats()).toMatchObject({ misses: LIVE_VARIANTS.length * 2, phase: 'scanning' })
    const sources = vi.mocked(deps.grab).mock.calls.map(([source]) => source)
    expect(sources).toContain('guide')
    expect(sources).toContain('full')
    const options = vi.mocked(deps.decode).mock.calls.map(([, opts]) => opts)
    expect(options.filter((o) => o.formats === PRIORITY_FORMATS).length).toBeGreaterThan(0)
    // Periodically every format, so PDF417/Data Matrix/Aztec and detect-only codes are still found.
    expect(options.some((o) => o.formats === undefined && o.tryHarder === true)).toBe(true)
  })

  it('applies the rotation variant to the captured pixels', () => {
    const sizes: Array<[number, number]> = []
    const decode = vi.fn((bitmap: GreyBitmap): DecodeResult => {
      sizes.push([bitmap.width, bitmap.height])
      return { status: 'not-found' }
    })
    const { scheduler } = makeLoop({ decode, grab: vi.fn(() => okFrame(textured(64, 48))) })
    for (let i = 0; i < LIVE_VARIANTS.length; i++) scheduler.runNext()
    const rotateIndex = LIVE_VARIANTS.findIndex((variant) => variant.transform === 'rotate90')
    expect(sizes[rotateIndex]).toEqual([48, 64])
  })

  it('paces ticks between the minimum and maximum gap', () => {
    let clock = 0
    let tickCost = 5
    const { scheduler } = makeLoop({
      now: () => clock,
      decode: () => {
        clock += tickCost
        return { status: 'not-found' }
      },
    })
    scheduler.runNext()
    expect(scheduler.lastDelay()).toBe(MIN_TICK_GAP_MS)
    tickCost = 10_000
    scheduler.runNext()
    expect(scheduler.lastDelay()).toBe(MAX_TICK_GAP_MS)
  })

  it('delivers a result exactly once and stops scheduling', () => {
    const result = { status: 'decoded', format: 'ean13', value: '0012345678905' } as const
    const { loop, scheduler, onResult, onStats } = makeLoop({ decode: vi.fn((): DecodeResult => result) })
    scheduler.runNext()
    expect(onResult).toHaveBeenCalledTimes(1)
    expect(onResult).toHaveBeenCalledWith(result)
    expect(scheduler.pending()).toBe(0)
    expect(loop.stats().phase).toBe('decoded')
    expect(onStats.mock.calls.at(-1)?.[0].phase).toBe('decoded')
    // Diagnostics never carry the value.
    expect(JSON.stringify(onStats.mock.calls)).not.toContain('0012345678905')
    loop.stop()
    expect(onResult).toHaveBeenCalledTimes(1)
  })

  it('requires two identical reads for Code 39 and resets on a different value', () => {
    const reads: DecodeResult[] = [
      { status: 'decoded', format: 'code39', value: 'A1' },
      { status: 'decoded', format: 'code39', value: 'B2' },
      { status: 'not-found' },
      { status: 'decoded', format: 'code39', value: 'B2' },
    ]
    const { loop, scheduler, onResult } = makeLoop({ decode: vi.fn((): DecodeResult => reads.shift()!) })
    scheduler.runNext()
    scheduler.runNext()
    scheduler.runNext()
    expect(onResult).not.toHaveBeenCalled()
    expect(loop.stats().unconfirmedReads).toBe(2)
    scheduler.runNext()
    expect(onResult).toHaveBeenCalledTimes(1)
    expect(onResult).toHaveBeenCalledWith({ status: 'decoded', format: 'code39', value: 'B2' })
  })

  it('stop() is idempotent and cancels the pending tick', () => {
    const { loop, scheduler, deps, onStats } = makeLoop()
    scheduler.runNext()
    loop.stop()
    loop.stop()
    expect(scheduler.pending()).toBe(0)
    expect(scheduler.runNext()).toBe(false)
    expect(deps.grab).toHaveBeenCalledTimes(1)
    expect(loop.stats().phase).toBe('stopped')
    expect(onStats.mock.calls.filter(([stats]) => stats.phase === 'stopped')).toHaveLength(1)
  })
})

describe('guide region', () => {
  it('maps the on-screen guide into a portrait frame shown with object-fit: cover', () => {
    // 1080×1920 frame in a 300×400 (3:4) viewport: visible area is 1080×1440, centred.
    const region = guideRegion(1080, 1920, 300, 400)
    expect(region.x).toBe(32)
    expect(region.width).toBe(1015)
    expect(region.y).toBe(240 + 288)
    expect(region.height).toBe(864)
  })

  it('falls back to fractions of the whole frame without layout', () => {
    expect(guideRegion(1000, 500, 0, 0)).toEqual({ x: 30, y: 100, width: 940, height: 300 })
  })
})

// ─── Part 2: camera adapter in jsdom ────────────────────────────────────────

/** Synthetic camera scene: dark surround, white card, real Code 128 in the middle. */
function codeScene(value: string): GreyBitmap {
  const width = 600
  const height = 800
  const data = new Uint8ClampedArray(width * height).fill(90)
  const code = renderWith('code128', value, createBitmapDrawing(), { scale: 2, includeText: false })
  const cardX = 60
  const cardY = 300
  const cardWidth = 480
  if (code.width > cardWidth - 40) throw new Error('fixture: barcode wider than the card')
  for (let y = cardY; y < cardY + 220; y++) data.fill(235, y * width + cardX, y * width + cardX + cardWidth)
  const ox = cardX + Math.floor((cardWidth - code.width) / 2)
  const oy = cardY + 20
  for (let y = 0; y < code.height; y++) {
    for (let x = 0; x < code.width; x++) data[(oy + y) * width + ox + x] = code.data[y * code.width + x]! < 128 ? 25 : 235
  }
  // Dark printed text left of the barcode on the same rows.
  for (let y = oy; y < oy + code.height; y++) data.fill(25, y * width + cardX + 4, y * width + cardX + 10)
  return { width, height, data }
}

/**
 * Minimal 2D context backed by an RGBA buffer: enough for the readback probe
 * (fillRect) and frame capture (drawImage from the scene, getImageData).
 */
function installFakeCanvas(scene: GreyBitmap, options: { alterReads?: boolean } = {}) {
  return vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    return fakeContext(this, scene, options)
  } as unknown as HTMLCanvasElement['getContext'])
}

function fakeContext(canvas: HTMLCanvasElement, scene: GreyBitmap, options: { alterReads?: boolean }): CanvasRenderingContext2D {
  let buffer = new Uint8ClampedArray(0)
  let bw = 0
  let bh = 0
  const ensure = () => {
    if (bw !== canvas.width || bh !== canvas.height) {
      bw = canvas.width
      bh = canvas.height
      buffer = new Uint8ClampedArray(bw * bh * 4).fill(255)
    }
  }
  const put = (x: number, y: number, v: number) => {
    const i = (y * bw + x) * 4
    buffer[i] = buffer[i + 1] = buffer[i + 2] = v
    buffer[i + 3] = 255
  }
  const context = {
    fillStyle: '#000000',
    fillRect(x: number, y: number, w: number, h: number) {
      ensure()
      const v = context.fillStyle.toLowerCase() === '#ffffff' ? 255 : 0
      for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) put(xx, yy, v)
    },
    drawImage(_source: unknown, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number) {
      ensure()
      for (let y = 0; y < dh; y++) {
        for (let x = 0; x < dw; x++) {
          const px = Math.min(scene.width - 1, Math.floor(sx + ((x + 0.5) * sw) / dw))
          const py = Math.min(scene.height - 1, Math.floor(sy + ((y + 0.5) * sh) / dh))
          put(dx + x, dy + y, scene.data[py * scene.width + px]!)
        }
      }
    },
    getImageData(_x: number, _y: number, w: number, h: number) {
      ensure()
      const data = buffer.slice(0, w * h * 4)
      if (options.alterReads) for (let i = 0; i < data.length; i += 4) data[i] = data[i + 1] = data[i + 2] = (i * 97) % 256
      return { data, width: w, height: h }
    },
  }
  return context as unknown as CanvasRenderingContext2D
}

function fakeStream() {
  const listeners = new Map<string, () => void>()
  const track = {
    stop: vi.fn(),
    addEventListener: vi.fn((type: string, listener: () => void) => listeners.set(type, listener)),
    removeEventListener: vi.fn((type: string) => listeners.delete(type)),
    getSettings: () => ({ width: 600, height: 800, frameRate: 30, facingMode: 'environment' }),
    getCapabilities: () => ({}),
  }
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream
  return { stream, track, fireEnded: () => listeners.get('ended')?.() }
}

function fakeVideo(options: { play?: () => Promise<void>; width?: number; height?: number } = {}) {
  const video = document.createElement('video')
  Object.defineProperty(video, 'readyState', { value: 4, configurable: true })
  Object.defineProperty(video, 'videoWidth', { value: options.width ?? 600, configurable: true })
  Object.defineProperty(video, 'videoHeight', { value: options.height ?? 800, configurable: true })
  Object.defineProperty(video, 'paused', { value: false, configurable: true, writable: true })
  video.play = vi.fn(options.play ?? (() => Promise.resolve()))
  return video
}

function stubCamera(getUserMedia: () => Promise<MediaStream>) {
  vi.stubGlobal('isSecureContext', true)
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: vi.fn(getUserMedia) }, configurable: true })
}

describe('startCameraScan (jsdom adapter)', () => {
  beforeEach(() => {
    resetCanvasProbe()
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('refuses to start outside a secure context', async () => {
    vi.stubGlobal('isSecureContext', false)
    await expect(startCameraScan(fakeVideo(), vi.fn())).rejects.toMatchObject({ kind: 'insecure' })
  })

  it.each([
    ['NotAllowedError', 'denied'],
    ['NotReadableError', 'in-use'],
    ['OverconstrainedError', 'not-found'],
    ['AbortError', 'failed'],
  ])('maps getUserMedia %s to %s', async (name, kind) => {
    stubCamera(() => Promise.reject(new DOMException('x', name)))
    await expect(startCameraScan(fakeVideo(), vi.fn())).rejects.toMatchObject({ kind })
  })

  it('decodes a Code 128 card from live frames, delivers it once, and releases the camera', async () => {
    const { stream, track } = fakeStream()
    stubCamera(() => Promise.resolve(stream))
    installFakeCanvas(codeScene('0042 LOYAL'))
    const video = fakeVideo()
    const onResult = vi.fn()
    const reports: ScanDiagnostics[] = []
    await startCameraScan(video, onResult, { onDiagnostics: (d) => reports.push(d) })

    await vi.waitFor(() => expect(onResult).toHaveBeenCalled(), { timeout: 4000 })
    expect(onResult).toHaveBeenCalledTimes(1)
    expect(onResult).toHaveBeenCalledWith({ status: 'decoded', format: 'code128', value: '0042 LOYAL' })
    expect(track.stop).toHaveBeenCalled()
    expect(video.srcObject).toBeNull()
    const last = reports.at(-1)!
    expect(last).toMatchObject({ phase: 'decoded', frameWidth: 600, frameHeight: 800, canvasReadback: 'ok', code128Patch: 'applied' })
    expect(JSON.stringify(reports)).not.toContain('LOYAL')
  })

  it('stop() is idempotent, stops every track and clears the video', async () => {
    const { stream, track } = fakeStream()
    stubCamera(() => Promise.resolve(stream))
    installFakeCanvas({ width: 600, height: 800, data: new Uint8ClampedArray(600 * 800).fill(128) })
    const video = fakeVideo()
    const onResult = vi.fn()
    const session = await startCameraScan(video, onResult)
    session.stop()
    session.stop()
    expect(track.stop).toHaveBeenCalledTimes(1)
    expect(track.removeEventListener).toHaveBeenCalledWith('ended', expect.any(Function))
    expect(video.srcObject).toBeNull()
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(onResult).not.toHaveBeenCalled()
  })

  it('starts scanning even if play() never settles (bounded wait)', async () => {
    vi.useFakeTimers()
    const { stream } = fakeStream()
    stubCamera(() => Promise.resolve(stream))
    installFakeCanvas({ width: 600, height: 800, data: new Uint8ClampedArray(600 * 800).fill(128) })
    const video = fakeVideo({ play: () => new Promise<void>(() => undefined) })
    Object.defineProperty(video, 'paused', { value: true, configurable: true })
    const reports: ScanDiagnostics[] = []
    const started = startCameraScan(video, vi.fn(), { onDiagnostics: (d) => reports.push(d) })
    await vi.advanceTimersByTimeAsync(3000)
    const session = await started
    expect(reports.at(-1)?.playback).toBe('timed-out')
    await vi.advanceTimersByTimeAsync(1000)
    expect(reports.at(-1)?.blankFrames).toBeGreaterThan(0)
    session.stop()
  })

  it('fails cleanly and releases the camera when play() rejects', async () => {
    const { stream, track } = fakeStream()
    stubCamera(() => Promise.resolve(stream))
    const video = fakeVideo({ play: () => Promise.reject(new DOMException('no', 'NotAllowedError')) })
    await expect(startCameraScan(video, vi.fn())).rejects.toBeInstanceOf(CameraError)
    expect(track.stop).toHaveBeenCalled()
    expect(video.srcObject).toBeNull()
  })

  it('reports a camera that ends by itself (e.g. screen lock) once', async () => {
    const { stream, track, fireEnded } = fakeStream()
    stubCamera(() => Promise.resolve(stream))
    installFakeCanvas({ width: 600, height: 800, data: new Uint8ClampedArray(600 * 800).fill(128) })
    const onError = vi.fn()
    const session = await startCameraScan(fakeVideo(), vi.fn(), { onError })
    fireEnded()
    fireEnded()
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError.mock.calls[0]?.[0]).toMatchObject({ kind: 'interrupted' })
    expect(track.stop).toHaveBeenCalled()
    session.stop()
  })

  it('flags a browser that alters canvas reads', async () => {
    const { stream } = fakeStream()
    stubCamera(() => Promise.resolve(stream))
    installFakeCanvas(codeScene('0042'), { alterReads: true })
    const reports: ScanDiagnostics[] = []
    const session = await startCameraScan(fakeVideo(), vi.fn(), { onDiagnostics: (d) => reports.push(d) })
    expect(reports.at(-1)?.canvasReadback).toBe('altered')
    session.stop()
  })
})

describe('decoder used by the adapter', () => {
  it('reads the synthetic scene directly (sanity check for the fixture)', () => {
    expect(decodeBitmap(codeScene('0042 LOYAL'), { formats: PRIORITY_FORMATS })).toEqual({
      status: 'decoded',
      format: 'code128',
      value: '0042 LOYAL',
    })
  })
})
