/**
 * Live camera scanning adapter: owns the MediaStream, the <video> binding and
 * an off-DOM canvas, and drives the DOM-free scan loop (scanLoop.ts) with
 * frames captured from the video.
 *
 * Privacy: frames are drawn to an off-DOM canvas, decoded, and overwritten by
 * the next frame. No frame is stored, saved, or sent anywhere. Diagnostics
 * carry dimensions, counts and error categories only, never decoded values.
 *
 * Resource ownership: the returned session owns the MediaStream. `stop()` is
 * idempotent; it cancels the pending tick, stops every track (turning off the
 * camera indicator), clears `srcObject` and removes listeners. A confirmed
 * detection or a camera interruption stops the session automatically.
 * Callers must still call `stop()` on cancel and unmount.
 *
 * Platform notes:
 * - getUserMedia needs a secure context (HTTPS or localhost) and permission.
 * - iOS (Safari and every iOS browser, including Brave, which must use
 *   WebKit) requires a muted, `playsInline` video for inline playback. The
 *   `play()` promise is awaited only for a bounded time: if it neither
 *   resolves nor rejects, scanning starts anyway and the loop simply counts
 *   not-ready frames until the video delivers pictures, instead of the whole
 *   scanner hanging in "Starting the camera…".
 * - The frame size actually delivered is read from the video on every tick
 *   (it changes with device orientation) and reported in diagnostics, along
 *   with MediaStreamTrack.getSettings().
 * - Continuous autofocus is requested only where the track advertises it
 *   (iOS generally does not; it autofocuses continuously by default). Phones
 *   whose main camera cannot focus very close (e.g. recent "Pro" iPhones)
 *   need the card held ~15–25 cm away; the UI says so when scanning stalls.
 * - Torch and zoom controls are not offered: support is inconsistent across
 *   browsers and absent from many iOS versions.
 */
import { decodeBitmap, rgbaToGrey } from './decode.ts'
import { probeCanvasReadback, type CanvasReadback } from './canvasProbe.ts'
import {
  FrameError,
  guideRegion,
  startScanLoop,
  type FoundResult,
  type FrameSource,
  type GrabResult,
  type LoopStats,
  type ScanLoopDeps,
} from './scanLoop.ts'
import { code128PatchStatus, type PatchStatus } from './zxingPatches.ts'

export type { FoundResult, LoopStats }

export interface CameraSession {
  stop(): void
}

export type CameraErrorKind = 'insecure' | 'unavailable' | 'denied' | 'not-found' | 'in-use' | 'failed' | 'interrupted'

export class CameraError extends Error {
  readonly kind: CameraErrorKind
  constructor(kind: CameraErrorKind) {
    super(CAMERA_MESSAGES[kind])
    this.name = 'CameraError'
    this.kind = kind
  }
}

const CAMERA_MESSAGES: Record<CameraErrorKind, string> = {
  insecure: 'The camera only works when the app is opened over HTTPS.',
  unavailable: 'This browser doesn’t provide camera access.',
  denied: 'Camera access was denied. Allow it in your browser settings, or import a picture instead.',
  'not-found': 'No camera was found on this device.',
  'in-use': 'The camera is being used by another app.',
  failed: 'The camera couldn’t be started.',
  interrupted: 'The camera stopped (the screen may have locked, or another app took the camera).',
}

/** Privacy-safe snapshot for the on-screen "Scan details" panel. */
export interface ScanDiagnostics extends LoopStats {
  /** What the browser actually selected (getSettings), if reported. */
  track: { width?: number; height?: number; frameRate?: number; facingMode?: string; focusMode?: string }
  canvasReadback: CanvasReadback
  playback: 'pending' | 'playing' | 'timed-out'
  code128Patch: PatchStatus
}

export interface CameraScanOptions {
  /** Called a few times per second and on every phase change. */
  onDiagnostics?: (diagnostics: ScanDiagnostics) => void
  /** Called once if the camera stops by itself after starting (the session is already stopped). */
  onError?: (error: CameraError) => void
}

/** Bounded wait for `video.play()`; see the platform notes above. */
const PLAY_TIMEOUT_MS = 3000
/** If no new video frame is signalled within this time, the tick runs anyway. */
const FRAME_CALLBACK_FALLBACK_MS = 250

/** requestVideoFrameCallback exists in iOS Safari 15.4+ and Chromium; older engines fall back to timers. */
function hasFrameCallback(video: HTMLVideoElement): boolean {
  return typeof video.requestVideoFrameCallback === 'function'
}

export async function startCameraScan(
  video: HTMLVideoElement,
  onResult: (result: FoundResult) => void,
  options: CameraScanOptions = {},
): Promise<CameraSession> {
  if (!window.isSecureContext) throw new CameraError('insecure')
  if (!navigator.mediaDevices?.getUserMedia) throw new CameraError('unavailable')

  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      // `ideal`, not `exact`: laptops have only a front camera and should still work.
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    })
  } catch (error) {
    const name = error instanceof DOMException ? error.name : ''
    if (name === 'NotAllowedError' || name === 'SecurityError') throw new CameraError('denied')
    if (name === 'NotFoundError' || name === 'OverconstrainedError') throw new CameraError('not-found')
    if (name === 'NotReadableError') throw new CameraError('in-use')
    throw new CameraError('failed')
  }

  const [track] = stream.getVideoTracks()
  let stopped = false
  // Assigned once scanning starts; stop() may run earlier (e.g. play() rejects).
  let loop: { stop(): void } | undefined = undefined
  const cleanups: Array<() => void> = []

  const stop = () => {
    if (stopped) return
    stopped = true
    loop?.stop()
    for (const cleanup of cleanups.splice(0)) cleanup()
    for (const t of stream.getTracks()) t.stop()
    video.srcObject = null
  }

  requestContinuousFocus(track)

  video.muted = true
  video.playsInline = true
  video.srcObject = stream
  let playback: ScanDiagnostics['playback'] = 'pending'
  try {
    playback = await playWithTimeout(video)
  } catch {
    stop()
    throw new CameraError('failed')
  }

  const onTrackEnded = () => {
    if (stopped) return
    stop()
    options.onError?.(new CameraError('interrupted'))
  }
  track?.addEventListener('ended', onTrackEnded)
  cleanups.push(() => track?.removeEventListener('ended', onTrackEnded))

  const canvasReadback = probeCanvasReadback()
  const grab = createFrameGrabber(video)

  const deps: ScanLoopDeps = {
    grab,
    decode: decodeBitmap,
    now: () => performance.now(),
    schedule: (callback, delayMs) => scheduleTick(video, callback, delayMs),
    onResult: (result) => {
      stop()
      onResult(result)
    },
    onStats: (stats) => {
      options.onDiagnostics?.({
        ...stats,
        track: trackSettings(track),
        canvasReadback,
        playback: video.paused ? playback : 'playing',
        code128Patch: code128PatchStatus,
      })
    },
  }
  loop = startScanLoop(deps)
  if (import.meta.env.DEV) cleanups.push(() => console.debug('[scan] session ended', trackSettings(track)))

  return { stop }
}

/** Resolves 'playing' when play() resolves, 'timed-out' if it neither resolves nor rejects in time; rejects if play() rejects. */
function playWithTimeout(video: HTMLVideoElement): Promise<'playing' | 'timed-out'> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve('timed-out'), PLAY_TIMEOUT_MS)
    Promise.resolve(video.play()).then(
      () => {
        clearTimeout(timer)
        resolve('playing')
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error instanceof Error ? error : new Error('play failed'))
      },
    )
  })
}

/** Best effort: only where the track advertises continuous focus. Never blocks or throws. */
function requestContinuousFocus(track: MediaStreamTrack | undefined) {
  try {
    const capabilities = track?.getCapabilities?.() as { focusMode?: string[] } | undefined
    if (track && capabilities?.focusMode?.includes('continuous')) {
      track.applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] }).catch(() => undefined)
    }
  } catch {
    // Capability queries are optional; the camera works without them.
  }
}

function trackSettings(track: MediaStreamTrack | undefined): ScanDiagnostics['track'] {
  try {
    const settings = (track?.getSettings?.() ?? {}) as MediaTrackSettings & { focusMode?: string }
    return {
      width: settings.width,
      height: settings.height,
      frameRate: settings.frameRate,
      facingMode: settings.facingMode,
      focusMode: settings.focusMode,
    }
  } catch {
    return {}
  }
}

/**
 * Waits `delayMs`, then for the next decoded video frame (so the same frame
 * is not decoded twice), but never longer than FRAME_CALLBACK_FALLBACK_MS for
 * that frame: requestVideoFrameCallback does not fire while the video is
 * paused or stalled, and the loop must keep ticking so stalls are counted.
 */
function scheduleTick(video: HTMLVideoElement, callback: () => void, delayMs: number): () => void {
  let done = false
  let frameHandle: number | undefined
  let fallback: ReturnType<typeof setTimeout> | undefined
  const fire = () => {
    if (done) return
    done = true
    if (fallback !== undefined) clearTimeout(fallback)
    if (frameHandle !== undefined && hasFrameCallback(video)) video.cancelVideoFrameCallback(frameHandle)
    callback()
  }
  const delay = setTimeout(() => {
    if (done) return
    if (hasFrameCallback(video)) {
      frameHandle = video.requestVideoFrameCallback(fire)
      fallback = setTimeout(fire, FRAME_CALLBACK_FALLBACK_MS)
    } else {
      fire()
    }
  }, delayMs)
  return () => {
    done = true
    clearTimeout(delay)
    if (fallback !== undefined) clearTimeout(fallback)
    if (frameHandle !== undefined && hasFrameCallback(video)) video.cancelVideoFrameCallback(frameHandle)
  }
}

/**
 * Captures the guide region or whole frame as greyscale. The canvas does the
 * crop and any downscale during drawImage; the canvas is reused and only
 * resized when the requested size changes.
 */
function createFrameGrabber(video: HTMLVideoElement): (source: FrameSource, maxSide: number) => GrabResult {
  const canvas = document.createElement('canvas')
  let context: CanvasRenderingContext2D | null | undefined
  return (source, maxSide) => {
    const frameWidth = video.videoWidth
    const frameHeight = video.videoHeight
    if (video.readyState < video.HAVE_CURRENT_DATA || frameWidth === 0 || frameHeight === 0) return { status: 'not-ready' }
    if (context === undefined) context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new FrameError('canvas-unavailable')
    const region =
      source === 'guide'
        ? guideRegion(frameWidth, frameHeight, video.clientWidth, video.clientHeight)
        : { x: 0, y: 0, width: frameWidth, height: frameHeight }
    const scale = Math.min(1, maxSide / Math.max(region.width, region.height))
    const width = Math.max(1, Math.round(region.width * scale))
    const height = Math.max(1, Math.round(region.height * scale))
    if (canvas.width !== width) canvas.width = width
    if (canvas.height !== height) canvas.height = height
    context.drawImage(video, region.x, region.y, region.width, region.height, 0, 0, width, height)
    const pixels = context.getImageData(0, 0, width, height)
    return { status: 'ok', bitmap: rgbaToGrey(pixels.data, width, height), frameWidth, frameHeight }
  }
}
