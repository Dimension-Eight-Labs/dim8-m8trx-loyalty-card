/**
 * Shared M8TRX product header (Iteration 4F).
 *
 * One component renders the brand lockup (official DIM8 logo + "M8TRX") in
 * the upper-left corner of every screen that shows a header: the wallet, the
 * add-card flow, About, and checkout. Position, typography and size come from
 * shared CSS (`.app-header`, `.brand-lockup` in app.css, sized by the
 * --brand-* tokens in tokens.css), so the screens cannot drift apart.
 *
 * - `action` fills the top-right corner: the wallet's Add Card button or
 *   checkout's close button. The header never changes their size or role.
 * - `decorative` hides the lockup from assistive technology and renders the
 *   bar as a plain <div> rather than a <header> (banner landmark). Checkout
 *   uses it because it is a modal dialog labelled by the card name;
 *   elsewhere "M8TRX" is ordinary text in the page banner.
 * - `className` lets a screen add placement rules (checkout's safe-area
 *   padding) without restyling the lockup itself.
 *
 * The logo is the official artwork with only its black canvas trimmed and
 * downscaled (scripts/generate-icons.mjs); it is decorative (alt="") because
 * the adjacent product name already says what the header is.
 */
import type { ReactNode } from 'react'
import headerLogoUrl from '../assets/brand/dim8-logo-120.png'
import aboutLogoUrl from '../assets/brand/dim8-logo-240.png'
import { APP_NAME } from '../app/appMetadata.ts'

export interface AppHeaderProps {
  action?: ReactNode
  decorative?: boolean
  className?: string
}

export function AppHeader({ action, decorative = false, className }: AppHeaderProps) {
  const Bar = decorative ? 'div' : 'header'
  return (
    <Bar className={className ? `app-header ${className}` : 'app-header'} data-testid="app-header">
      <BrandLockup decorative={decorative} />
      {action}
    </Bar>
  )
}

export interface BrandLockupProps {
  /** `header` is the compact corner lockup; `about` the larger centred one. */
  variant?: 'header' | 'about'
  decorative?: boolean
}

/** Official DIM8 logo immediately left of the M8TRX product name. */
export function BrandLockup({ variant = 'header', decorative = false }: BrandLockupProps) {
  const about = variant === 'about'
  return (
    <p
      className={about ? 'brand-lockup brand-lockup--about' : 'brand-lockup'}
      data-testid="brand-lockup"
      aria-hidden={decorative || undefined}
    >
      {/* Intrinsic sizes match the generated files, so layout never jumps while decoding. */}
      <img
        className="brand-lockup__logo"
        src={about ? aboutLogoUrl : headerLogoUrl}
        alt=""
        width={about ? 199 : 99}
        height={about ? 240 : 120}
        data-testid="brand-logo"
      />
      <span className="brand-lockup__title" data-testid="brand-title">
        {APP_NAME}
      </span>
    </p>
  )
}
