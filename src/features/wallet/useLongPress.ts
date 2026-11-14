/**
 * Long-press detection for wallet tiles, built on Pointer Events so it works
 * for touch, pen, and mouse alike.
 *
 * Behaviour:
 * - Holding for LONG_PRESS_MS without moving more than MOVE_TOLERANCE_PX
 *   fires `onLongPress` once.
 * - Moving further (e.g. scrolling the grid), lifting early, or the browser
 *   cancelling the pointer (pointercancel) aborts the press.
 * - After a long press fires, the click that follows the pointer release is
 *   swallowed, so the card does not also open.
 * - `contextmenu` (right-click on desktop; long-press on some Android
 *   browsers) also opens the menu, and the native context menu is suppressed.
 *
 * Timing rationale: 500 ms matches common platform long-press durations
 * (Android uses ~400–500 ms) and is long enough not to trigger on taps. 10 px
 * of slop tolerates finger jitter while still yielding to scroll gestures.
 */
import { useEffect, useRef, type MouseEvent, type PointerEvent } from 'react'

export const LONG_PRESS_MS = 500
export const MOVE_TOLERANCE_PX = 10

export function useLongPress(onLongPress: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const origin = useRef<{ x: number; y: number } | null>(null)
  const fired = useRef(false)

  const cancel = () => {
    if (timer.current !== undefined) clearTimeout(timer.current)
    timer.current = undefined
    origin.current = null
  }

  useEffect(() => cancel, [])

  const fire = () => {
    cancel()
    fired.current = true
    // Light haptic confirmation where supported (Android); a no-op elsewhere.
    navigator.vibrate?.(10)
    onLongPress()
  }

  return {
    onPointerDown(event: PointerEvent) {
      // Only the primary button / first touch starts a press.
      if (event.button !== 0 || !event.isPrimary) return
      fired.current = false
      origin.current = { x: event.clientX ?? 0, y: event.clientY ?? 0 }
      timer.current = setTimeout(fire, LONG_PRESS_MS)
    },
    onPointerMove(event: PointerEvent) {
      if (!origin.current) return
      const dx = (event.clientX ?? 0) - origin.current.x
      const dy = (event.clientY ?? 0) - origin.current.y
      if (Math.hypot(dx, dy) > MOVE_TOLERANCE_PX) cancel()
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    onContextMenu(event: MouseEvent) {
      event.preventDefault()
      if (!fired.current) fire()
    },
    /** Swallows the click that ends a long press. */
    onClickCapture(event: MouseEvent) {
      if (fired.current) {
        fired.current = false
        event.preventDefault()
        event.stopPropagation()
      }
    },
  }
}
