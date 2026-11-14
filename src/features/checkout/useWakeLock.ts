/**
 * Best-effort Screen Wake Lock while a card is on screen.
 *
 * Uses the Screen Wake Lock API where available (Chromium browsers, Safari
 * 16.4+). Home-screen web apps on iOS had a WebKit bug that made the lock
 * ineffective before iOS 18.4; this is unverified here and needs a real
 * device check. Browsers release the
 * lock whenever the page is hidden, so it is re-requested when the page
 * becomes visible again. Every failure (unsupported, denied, low battery) is
 * silent: the card still shows, the screen may just dim on its normal timer.
 *
 * There is no web API to raise screen brightness; the app does not try.
 */
import { useEffect } from 'react'

interface WakeLockSentinelLike {
  release(): Promise<void>
}
interface WakeLockLike {
  request(type: 'screen'): Promise<WakeLockSentinelLike>
}

export function useWakeLock(active: boolean): void {
  useEffect(() => {
    const wakeLock = (navigator as Navigator & { wakeLock?: WakeLockLike }).wakeLock
    if (!active || !wakeLock) return

    let sentinel: WakeLockSentinelLike | null = null
    let disposed = false

    const acquire = async () => {
      if (document.visibilityState !== 'visible') return
      try {
        const lock = await wakeLock.request('screen')
        if (disposed) void lock.release().catch(() => {})
        else sentinel = lock
      } catch {
        // Unsupported, denied, or not allowed right now: nothing to do.
      }
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') void acquire()
    }

    void acquire()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      disposed = true
      document.removeEventListener('visibilitychange', onVisibility)
      void sentinel?.release().catch(() => {})
    }
  }, [active])
}
