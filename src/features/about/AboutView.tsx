/**
 * About M8TRX: a minimal product page reached from the Add Card screen.
 *
 * Content is fixed product copy from src/app/appMetadata.ts; the version is
 * the built package version (never typed by hand). Two independent links,
 * the company website and the official source repository (code, license and
 * documentation), open in a new browsing context; they are the only
 * network-capable elements here and the page itself works offline. Back
 * returns to the Add Card screen.
 *
 * The "About" heading is visually hidden (v0.6.0); it still names the view
 * and takes focus on navigation for screen-reader users.
 */
import { BrandLockup } from '../../components/AppHeader.tsx'
import { BackIcon } from '../../components/icons.tsx'
import { ViewHeading } from '../../components/ViewHeading.tsx'
import {
  APP_ATTRIBUTION,
  APP_DESCRIPTION,
  APP_VERSION,
  LEGAL_NOTICE,
  SOURCE_LINK_LABEL,
  SOURCE_REPOSITORY_URL,
  WEBSITE_LABEL,
  WEBSITE_URL,
} from '../../app/appMetadata.ts'

export interface AboutViewProps {
  focusOnMount: boolean
  onBack: () => void
}

export function AboutView({ focusOnMount, onBack }: AboutViewProps) {
  return (
    <section className="about" aria-labelledby="about-heading">
      <button type="button" className="button button--ghost back-button" onClick={onBack}>
        <BackIcon />
        Back
      </button>
      <ViewHeading id="about-heading" className="visually-hidden" focusOnMount={focusOnMount}>
        About
      </ViewHeading>
      <div className="about__identity">
        <BrandLockup variant="about" />
        <p className="about__attribution">{APP_ATTRIBUTION}</p>
        <p className="about__version" data-testid="about-version">
          Version {APP_VERSION}
        </p>
      </div>
      <p className="about__description">{APP_DESCRIPTION}</p>
      <p className="about__link">
        <a href={WEBSITE_URL} target="_blank" rel="noopener noreferrer">
          {WEBSITE_LABEL}
        </a>
      </p>
      <p className="about__link">
        <a href={SOURCE_REPOSITORY_URL} target="_blank" rel="noopener noreferrer">
          {SOURCE_LINK_LABEL}
        </a>
      </p>
      <p className="about__legal">{LEGAL_NOTICE}</p>
    </section>
  )
}
