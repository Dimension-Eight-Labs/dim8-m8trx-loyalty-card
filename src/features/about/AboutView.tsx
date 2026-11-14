/**
 * About M8TRX: a minimal product page reached from the Add Card screen.
 *
 * Content is fixed product copy from src/app/appMetadata.ts; the version is
 * the built package version (never typed by hand). The website link opens in
 * a new browsing context and is the only network-capable element here; the
 * page itself works offline. Back returns to the Add Card screen.
 */
import { BrandLockup } from '../../components/AppHeader.tsx'
import { BackIcon } from '../../components/icons.tsx'
import { ViewHeading } from '../../components/ViewHeading.tsx'
import {
  APP_ATTRIBUTION,
  APP_DESCRIPTION,
  APP_VERSION,
  LEGAL_NOTICE,
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
      <ViewHeading id="about-heading" focusOnMount={focusOnMount}>
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
      <p className="about__legal">{LEGAL_NOTICE}</p>
    </section>
  )
}
