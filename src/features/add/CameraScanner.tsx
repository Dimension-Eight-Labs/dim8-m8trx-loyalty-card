/**
 * Live camera viewfinder for scanning a physical card.
 *
 * States: starting → scanning → (captured | problem). While scanning, the
 * status line says the app is looking; if nothing is detected within
 * STALL_MS the scanner keeps scanning but adds guidance (distance, light,
 * orientation, or a specific cause taken from the diagnostics) and offers
 * Scan again / Import image / Enter manually, so the user is never left in
 * an apparently inactive viewfinder.
 *
 * Lifecycle: the camera starts on mount and always stops on unmount (Back,
 * success, or navigating away) and on "Scan again", so the camera indicator
 * never stays on. Results, errors and diagnostics arriving after unmount or
 * after a restart are ignored, and a capture is reported at most once per
 * camera session.
 *
 * If a code is found that can't be redrawn, scanning stops with an
 * explanation; the user can scan again, import a picture instead (which
 * allows an image fallback), or type the number.
 *
 * Diagnostics ("Scan details") show dimensions, counts, timings and error
 * categories only — never the decoded value — and are shown only when
 * scanning stalls or fails, to help real-device troubleshooting.
 */
import { useEffect, useRef, useState } from 'react'
import { ViewHeading } from '../../components/ViewHeading.tsx'
import type { CardBarcode } from '../cards/card.ts'
import { outcomeFromDecode } from './captureOutcome.ts'
import type { CaptureServices, ScanDiagnostics } from './captureServices.ts'

export interface CameraScannerProps {
  services: CaptureServices
  focusOnMount: boolean
  onCaptured: (barcode: CardBarcode) => void
  onImport: () => void
  onManual: () => void
}

type State = { name: 'starting' } | { name: 'scanning' } | { name: 'problem'; message: string; canRetry: boolean }

/**
 * Time without a detection before guidance appears. Long enough that a
 * normal scan (usually well under 2 s) never sees it, short enough that a
 * user who is struggling gets help before giving up.
 */
const STALL_MS = 8000

export function CameraScanner({ services, focusOnMount, onCaptured, onImport, onManual }: CameraScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [state, setState] = useState<State>({ name: 'starting' })
  const [stalled, setStalled] = useState(false)
  const [diagnostics, setDiagnostics] = useState<ScanDiagnostics | null>(null)
  // Bumped by "Scan again" to restart the camera effect.
  const [attempt, setAttempt] = useState(0)
  // Keep the latest callbacks without restarting the camera when they change.
  const latest = useRef({ onCaptured, services })
  useEffect(() => {
    latest.current = { onCaptured, services }
  })

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    // `active` is false after unmount/restart or once a result was handled;
    // every callback checks it, so late callbacks have no effect.
    let active = true
    let session: { stop(): void } | null = null
    let stallTimer: ReturnType<typeof setTimeout> | undefined

    // Idempotent: runs on result, on camera error, and again on unmount.
    const finish = () => {
      if (!active) return
      active = false
      if (stallTimer !== undefined) clearTimeout(stallTimer)
      session?.stop()
    }

    latest.current.services
      .startCamera(
        video,
        (result) => {
          if (!active) return
          finish()
          const outcome = outcomeFromDecode(result, latest.current.services.verify)
          if (outcome.ok) latest.current.onCaptured(outcome.barcode)
          else
            setState({
              name: 'problem',
              message: `${outcome.message} Import a screenshot or photo to save it as an image instead.`,
              canRetry: true,
            })
        },
        {
          onDiagnostics: (next) => {
            if (active) setDiagnostics(next)
          },
          onError: (error) => {
            if (!active) return
            finish()
            setState({ name: 'problem', message: error.message, canRetry: true })
          },
        },
      )
      .then(
        (started) => {
          if (!active) {
            started.stop()
            return
          }
          session = started
          setState({ name: 'scanning' })
          stallTimer = setTimeout(() => {
            if (active) setStalled(true)
          }, STALL_MS)
        },
        (error: unknown) => {
          if (!active) return
          active = false
          setState({
            name: 'problem',
            message: error instanceof Error ? error.message : 'The camera couldn’t be started.',
            canRetry: false,
          })
        },
      )

    return finish
  }, [attempt])

  const restart = () => {
    setState({ name: 'starting' })
    setStalled(false)
    setDiagnostics(null)
    setAttempt((n) => n + 1)
  }

  const showStallHelp = state.name === 'scanning' && stalled

  return (
    <div className="scanner">
      <ViewHeading id="add-flow-heading" focusOnMount={focusOnMount}>
        Scan card
      </ViewHeading>
      <div className="scanner__viewport">
        {/* Muted + playsInline: required for inline autoplay on iOS. No audio is requested. */}
        <video ref={videoRef} className="scanner__video" muted playsInline aria-label="Camera viewfinder" />
        <div className="scanner__frame" aria-hidden="true" />
      </div>
      <p className="scanner__status" role="status">
        {state.name === 'starting' && 'Starting the camera…'}
        {state.name === 'scanning' && 'Looking for a barcode… Hold it inside the frame, flat and well lit.'}
      </p>

      {showStallHelp && (
        <div className="scanner__problem">
          <div className="notice">
            <p>{stallMessage(diagnostics, services.canvasReadback?.())}</p>
            <ul className="scanner__tips">
              <li>Hold the phone about 15–25 cm (6–10 in) away so the camera can focus.</li>
              <li>Add light and tilt the card slightly to avoid glare.</li>
              <li>Turn the card so the bars run across the frame.</li>
            </ul>
          </div>
          <ProblemActions canRetry onRetry={restart} onImport={onImport} onManual={onManual} />
          <ScanDetails diagnostics={diagnostics} />
        </div>
      )}

      {state.name === 'problem' && (
        <div className="scanner__problem">
          <p className="notice notice--error" role="alert">
            {state.message}
          </p>
          <ProblemActions canRetry={state.canRetry} onRetry={restart} onImport={onImport} onManual={onManual} />
          <ScanDetails diagnostics={diagnostics} />
        </div>
      )}
    </div>
  )
}

function ProblemActions(props: { canRetry: boolean; onRetry: () => void; onImport: () => void; onManual: () => void }) {
  return (
    <div className="button-row">
      {props.canRetry && (
        <button type="button" className="button button--secondary" onClick={props.onRetry}>
          Scan again
        </button>
      )}
      <button type="button" className="button button--secondary" onClick={props.onImport}>
        Import image
      </button>
      <button type="button" className="button button--secondary" onClick={props.onManual}>
        Enter manually
      </button>
    </div>
  )
}

/**
 * Picks the most specific explanation the diagnostics support. Heuristics:
 * frames that never arrive point at the camera/video; frames that arrive
 * blank (or a failed canvas probe) point at a browser blocking pixel reads;
 * otherwise the picture is fine and the problem is focus, light or angle.
 */
function stallMessage(diagnostics: ScanDiagnostics | null, readback?: string): string {
  const generic = 'No barcode detected yet.'
  if (!diagnostics) return generic
  const pixelsBlocked =
    readback === 'altered' ||
    diagnostics.canvasReadback === 'altered' ||
    (diagnostics.blankFrames >= 5 && diagnostics.blankFrames > diagnostics.framesDecoded)
  if (pixelsBlocked) {
    return 'The camera picture is showing, but this browser isn’t letting the app read it. If you use Brave, turn off Shields (fingerprinting protection) for this site and scan again, or import a screenshot instead.'
  }
  if (diagnostics.framesDecoded === 0 && diagnostics.frameErrors > 0) {
    return 'The app couldn’t read pictures from the camera. Scan again, or import a screenshot instead.'
  }
  if (diagnostics.framesDecoded === 0 && diagnostics.framesNotReady > 0) {
    return 'The camera hasn’t delivered a picture yet. Scan again if the viewfinder stays still.'
  }
  return generic
}

function ScanDetails({ diagnostics }: { diagnostics: ScanDiagnostics | null }) {
  if (!diagnostics) return null
  const d = diagnostics
  const size = (w?: number, h?: number) => (w && h ? `${w} × ${h}` : 'not reported')
  const rows: Array<[string, string]> = [
    ['Camera frame', size(d.frameWidth, d.frameHeight)],
    ['Camera setting', `${size(d.track.width, d.track.height)}${d.track.frameRate ? ` @ ${Math.round(d.track.frameRate)} fps` : ''}`],
    ['Facing / focus', `${d.track.facingMode ?? 'not reported'} / ${d.track.focusMode ?? 'not reported'}`],
    ['Decoded area', size(d.sampleWidth, d.sampleHeight)],
    ['Frames checked', String(d.framesDecoded)],
    ['No picture yet', String(d.framesNotReady)],
    ['Blank frames', String(d.blankFrames)],
    ['Frame / decoder errors', `${d.frameErrors} / ${d.decoderErrors}${d.lastErrorCategory ? ` (last: ${d.lastErrorCategory})` : ''}`],
    ['Unconfirmed reads', String(d.unconfirmedReads)],
    ['Last frame time', `${Math.round(d.lastTickMs)} ms`],
    ['Scanning for', `${Math.round(d.elapsedMs / 1000)} s`],
    ['Playback', d.playback],
    ['Canvas reads', d.canvasReadback],
    ['Code 128 fix', d.code128Patch],
  ]
  return (
    <details className="scanner__details">
      <summary>Scan details</summary>
      <dl>
        {rows.map(([label, value]) => (
          <div key={label} className="scanner__detail">
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </details>
  )
}
