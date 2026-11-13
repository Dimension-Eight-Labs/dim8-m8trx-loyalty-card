/**
 * Application composition root.
 *
 * Owns top-level layout and wires feature components together. It deliberately
 * has no router, global state, or persistence: the only screen today is the
 * home screen, which always shows the empty state because card storage has
 * not been implemented yet.
 */
import { useState } from 'react'
import { AppHeader } from '../components/AppHeader.tsx'
import { CardEmptyState } from '../features/cards/CardEmptyState.tsx'

/**
 * Message announced when Add Card is activated. Card entry is a later
 * milestone; until then the button gives honest feedback rather than
 * appearing broken or pretending a card was saved.
 */
export const ADD_CARD_UNAVAILABLE_MESSAGE = 'Adding cards isn’t available yet.'

export function App() {
  const [statusMessage, setStatusMessage] = useState('')

  // Integration seam for the future card-entry workflow.
  const handleAddCard = () => {
    setStatusMessage(ADD_CARD_UNAVAILABLE_MESSAGE)
  }

  return (
    <div className="app-shell">
      <AppHeader />
      <main className="app-main">
        <CardEmptyState onAddCard={handleAddCard} />
        {/* Polite live region so screen readers hear the feedback without losing focus. */}
        <p className="app-status" role="status" aria-live="polite">
          {statusMessage}
        </p>
      </main>
    </div>
  )
}
