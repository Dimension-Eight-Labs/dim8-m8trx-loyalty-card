/**
 * Top-level heading for a screen.
 *
 * The app switches screens without a router, so the browser does not move
 * focus on "navigation". When `focusOnMount` is set, the heading takes focus
 * as it appears, which tells keyboard and screen-reader users that the screen
 * changed and puts them at its start. It is left off for the very first
 * screen so initial page load behaves normally.
 *
 * Secondary screens (add-card steps, About) pass `className="visually-hidden"`
 * (v0.6.0): the persistent M8TRX header and Back button already orient
 * sighted users, so a large visible title was redundant, but the heading
 * still names the view for screen readers and remains the focus target.
 */
import { useEffect, useRef, type ReactNode } from 'react'

export interface ViewHeadingProps {
  id?: string
  className?: string
  focusOnMount?: boolean
  children: ReactNode
}

export function ViewHeading({ id, className, focusOnMount = false, children }: ViewHeadingProps) {
  const ref = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    if (focusOnMount) ref.current?.focus()
  }, [focusOnMount])

  return (
    // tabIndex -1: focusable from script only, not added to the Tab order.
    <h1 ref={ref} id={id} className={className ?? 'view-heading'} tabIndex={-1}>
      {children}
    </h1>
  )
}
