/**
 * Line-art category icons for wallet tiles and the icon picker (v0.6.0).
 *
 * Artwork: original drawings made for M8TRX, inline in this file and
 * distributed under the repository license. No icon font, emoji, image file
 * or network request is involved, so every icon renders identically on every
 * platform and works offline.
 *
 * Drawing rules, shared by every icon so they read as one set:
 * - one 24×24 viewBox, artwork kept inside roughly 2–22 on both axes;
 * - strokes only (no fills), width 2, round caps and joins;
 * - strokes in `currentColor` on a transparent background.
 *
 * Contrast (v0.6.1): the icon inherits the surrounding text color, so on
 * every surface that shows a card (wallet tile, card-menu header, checkout
 * band, icon-picker preview) it is exactly the palette's paired text color
 * from tileColors.ts: Soft Silver on the fourteen dark colors and Charcoal on
 * Ivory. Every pairing is at least 3:1 (the WCAG graphical-object level), so
 * no outline is needed. v0.6.0's white strokes with a dark
 * "halo" under-stroke on light tiles were removed after iPhone testing.
 *
 * Decorative: the SVG is aria-hidden. The tile is named by the card name and
 * the picker labels each option with its category name.
 */
import type { ReactNode } from 'react'
import type { CardIconId } from './cardIcons.ts'

const STROKE = 2

/** Path data per category; each value is one or more SVG elements. */
const ARTWORK: Record<CardIconId, ReactNode> = {
  // Dumbbell: two plates joined by a bar, with short grips at the ends.
  fitness: (
    <>
      <rect x="5" y="7" width="3" height="10" rx="1" />
      <rect x="16" y="7" width="3" height="10" rx="1" />
      <path d="M8 12h8M2.5 12H5M19 12h2.5" />
    </>
  ),
  // Shopping basket: tapered body, two handle struts, three slats.
  grocery: (
    <>
      <path d="M3.5 10h17l-1.6 8.3a2 2 0 0 1-2 1.7H7.1a2 2 0 0 1-2-1.7Z" />
      <path d="M7.5 10l3-5.5M16.5 10l-3-5.5M9.5 13.5v3M12 13.5v3M14.5 13.5v3" />
    </>
  ),
  // Fuel pump: pump body with a window, base, and hose to the nozzle.
  fuel: (
    <>
      <path d="M5 20V5.5A1.5 1.5 0 0 1 6.5 4h5A1.5 1.5 0 0 1 13 5.5V20M3.5 20h11" />
      <path d="M7.5 7.5h3v3h-3Z" />
      <path d="M13 12h1.5a1.5 1.5 0 0 1 1.5 1.5V17a1.5 1.5 0 0 0 3 0V9.5L16.5 7" />
    </>
  ),
  // Hex nut and bolt (v0.6.1; replaced a wrench, which read as car repair
  // rather than a hardware store): a bolt in side view on the left (head,
  // shank with a rounded tip, three thread marks) and a nut seen face-on on
  // the right (regular hexagon, radius 5.5, around its threaded hole). Side by
  // side rather than assembled, because a nut drawn on the shank read as a
  // stack of bars at tile size.
  hardware: (
    <>
      <path d="M4.5 3h5a1 1 0 0 1 1 1v3h-7V4a1 1 0 0 1 1-1Z" />
      <path d="M5.5 7v12.5a1.5 1.5 0 0 0 3 0V7" />
      <path d="M5.5 11l3-1.5M5.5 14.5l3-1.5M5.5 18l3-1.5" />
      <path d="M16.5 8.5l4.76 2.75v5.5L16.5 19.5l-4.76-2.75v-5.5Z" />
      <circle cx="16.5" cy="14" r="2" />
    </>
  ),
  // Fork (three tines) and knife side by side.
  food: (
    <>
      <path d="M5 3v4.5a2 2 0 0 0 4 0V3M7 3v18" />
      <path d="M17 21V3c-2.2 1.2-3.2 3.6-3.2 7v3.5H17" />
    </>
  ),
  // Coffee cup with handle and two wisps of steam.
  coffee: (
    <>
      <path d="M4 9h12v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5Z" />
      <path d="M16 10.5h1.5a2.5 2.5 0 0 1 0 5H16" />
      <path d="M8 3.5c-.6 1 .6 2 0 3M12 3.5c-.6 1 .6 2 0 3" />
    </>
  ),
  // Shopping bag with a rounded carry handle.
  retail: (
    <>
      <path d="M5.5 8h13l-.9 12.1a1 1 0 0 1-1 .9H7.4a1 1 0 0 1-1-.9Z" />
      <path d="M9 10.5V7a3 3 0 0 1 6 0v3.5" />
    </>
  ),
  // Admission ticket: notched sides and a perforation line.
  events: (
    <>
      <path d="M4 7h16a1 1 0 0 1 1 1v2a2 2 0 0 0 0 4v2a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-2a2 2 0 0 0 0-4V8a1 1 0 0 1 1-1Z" />
      <path d="M15 7.5v1.5M15 11.25v1.5M15 15v1.5" />
    </>
  ),
  // Gear (v0.6.1): machinery, manufacturing, engineering and industrial
  // equipment. A conventional symmetrical cog centred on (12, 12): eight
  // evenly spaced teeth (one every 45°) whose tips lie on r = 10 (±7.5° of
  // arc) and whose flanks drop to a root circle of r = 7.25 (±10.5°), around
  // a circular opening of r = 3. The coordinates were computed from those
  // parameters and rounded to 0.01. Eight teeth with near-parallel flanks
  // keep a visible gap between teeth at tile and picker sizes; more teeth
  // would close the gaps at stroke width 2.
  gear: (
    <>
      <path d="M10.68 4.87L10.69 2.09A10 10 0 0 1 13.31 2.09L13.32 4.87A7.25 7.25 0 0 1 16.11 6.03L18.09 4.07A10 10 0 0 1 19.93 5.91L17.97 7.89A7.25 7.25 0 0 1 19.13 10.68L21.91 10.69A10 10 0 0 1 21.91 13.31L19.13 13.32A7.25 7.25 0 0 1 17.97 16.11L19.93 18.09A10 10 0 0 1 18.09 19.93L16.11 17.97A7.25 7.25 0 0 1 13.32 19.13L13.31 21.91A10 10 0 0 1 10.69 21.91L10.68 19.13A7.25 7.25 0 0 1 7.89 17.97L5.91 19.93A10 10 0 0 1 4.07 18.09L6.03 16.11A7.25 7.25 0 0 1 4.87 13.32L2.09 13.31A10 10 0 0 1 2.09 10.69L4.87 10.68A7.25 7.25 0 0 1 6.03 7.89L4.07 5.91A10 10 0 0 1 5.91 4.07L7.89 6.03A7.25 7.25 0 0 1 10.68 4.87Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
}

export interface CardCategoryIconProps {
  icon: CardIconId
  className?: string
}

/** Renders in the inherited text color; set `color` on an ancestor. */
export function CardCategoryIcon({ icon, className }: CardCategoryIconProps) {
  const artwork = ARTWORK[icon]
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-icon={icon}
    >
      <g stroke="currentColor" strokeWidth={STROKE}>
        {artwork}
      </g>
    </svg>
  )
}
