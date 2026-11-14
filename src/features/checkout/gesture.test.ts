/**
 * Checkout gesture rules (pure function; host tests). The integration tests in
 * App.test.tsx drive the same rules through pointer events. Neither proves how
 * a real touch screen feels; thresholds still need checking on an iPhone.
 */
import { describe, expect, it } from 'vitest'
import { DISMISS_DISTANCE_PX, GESTURE_DEAD_ZONE_PX, gestureAction, SWIPE_DISTANCE_PX } from './gesture.ts'

describe('gestureAction', () => {
  it('ignores taps and movement inside the dead zone', () => {
    expect(gestureAction(0, 0, undefined)).toBe('none')
    expect(gestureAction(GESTURE_DEAD_ZONE_PX - 3, 2, undefined)).toBe('none')
  })

  it('switches cards on a clear horizontal swipe', () => {
    expect(gestureAction(-SWIPE_DISTANCE_PX, 5, 'x')).toBe('next')
    expect(gestureAction(SWIPE_DISTANCE_PX + 10, -5, 'x')).toBe('previous')
    expect(gestureAction(-(SWIPE_DISTANCE_PX - 1), 0, 'x')).toBe('none')
  })

  it('closes only on a deliberate, steep downward swipe', () => {
    expect(gestureAction(0, DISMISS_DISTANCE_PX, 'y')).toBe('close')
    expect(gestureAction(40, 200, 'y')).toBe('close')
    expect(gestureAction(0, DISMISS_DISTANCE_PX - 1, 'y')).toBe('none') // too short
    expect(gestureAction(100, 140, 'y')).toBe('none') // too diagonal (ratio 1.4 < 1.5)
    expect(gestureAction(0, -300, 'y')).toBe('none') // upward never closes
  })

  it('respects the locked axis', () => {
    expect(gestureAction(-20, 300, 'x')).toBe('none') // horizontal gesture can't close
    expect(gestureAction(-200, 210, 'y')).toBe('none') // vertical gesture can't switch
  })

  it('classifies releases without move events by their dominant axis', () => {
    expect(gestureAction(-120, 10, undefined)).toBe('next')
    expect(gestureAction(5, 150, undefined)).toBe('close')
  })
})
