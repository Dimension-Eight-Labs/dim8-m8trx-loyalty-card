/**
 * Empty state for the card list: explains that no cards exist yet and offers
 * the primary Add Card action.
 *
 * Presentation only. The component does not know how cards are created or
 * stored; the parent supplies `onAddCard`, so the card-entry workflow can be
 * connected later without changing this component.
 */
export interface CardEmptyStateProps {
  /** Invoked when the user activates the Add Card button. */
  onAddCard: () => void
}

export function CardEmptyState({ onAddCard }: CardEmptyStateProps) {
  return (
    <section className="empty-state" aria-labelledby="empty-state-heading">
      <CardIllustration />
      <h1 id="empty-state-heading" className="empty-state__heading">
        No cards yet
      </h1>
      <p className="empty-state__body">
        Keep your loyalty and membership cards on your phone, ready to show at checkout.
      </p>
      <button type="button" className="button button--primary" onClick={onAddCard}>
        <PlusIcon />
        Add Card
      </button>
    </section>
  )
}

/** Decorative outline of a card; hidden from assistive technology. */
function CardIllustration() {
  return (
    <svg
      className="empty-state__illustration"
      viewBox="0 0 120 80"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="4" y="4" width="112" height="72" rx="10" fill="none" stroke="currentColor" strokeWidth="4" />
      <rect x="4" y="22" width="112" height="12" fill="currentColor" opacity="0.35" />
      <rect x="16" y="50" width="40" height="8" rx="4" fill="currentColor" opacity="0.35" />
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg className="button__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  )
}
