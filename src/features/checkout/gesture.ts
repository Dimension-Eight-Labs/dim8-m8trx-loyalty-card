/**
 * Checkout gesture thresholds and classification, kept free of React so the
 * rules can be unit-tested directly (see gesture.test.ts) and reused.
 * The behaviour these numbers implement is described in CheckoutScreen.tsx.
 */

/** Horizontal travel needed to switch cards. */
export const SWIPE_DISTANCE_PX = 60
/** Movement below this is a tap or jitter: no feedback, no direction chosen. */
export const GESTURE_DEAD_ZONE_PX = 12
/**
 * Downward travel needed to close: about an eighth of a phone screen, clearly
 * more than a tap wobble or a sloppy horizontal swipe, yet comfortable with a thumb.
 */
export const DISMISS_DISTANCE_PX = 110
/** Downward travel must be at least this multiple of sideways travel to close. */
export const DISMISS_AXIS_RATIO = 1.5

export type Axis = 'x' | 'y'

/**
 * Decides what a released gesture does. `axis` is the direction locked during
 * the drag (undefined if it never left the dead zone). Pure, for testing.
 */
export function gestureAction(dx: number, dy: number, axis: Axis | undefined): 'next' | 'previous' | 'close' | 'none' {
  const lock = axis ?? (Math.hypot(dx, dy) < GESTURE_DEAD_ZONE_PX ? undefined : Math.abs(dx) > Math.abs(dy) ? 'x' : 'y')
  if (lock === 'x' && Math.abs(dx) >= SWIPE_DISTANCE_PX && Math.abs(dx) > Math.abs(dy)) return dx < 0 ? 'next' : 'previous'
  if (lock === 'y' && dy >= DISMISS_DISTANCE_PX && dy >= Math.abs(dx) * DISMISS_AXIS_RATIO) return 'close'
  return 'none'
}
