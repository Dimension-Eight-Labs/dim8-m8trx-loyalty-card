/**
 * Compact product header shown above the wallet and the add-card flow.
 * `action` fills the top-right corner (the wallet's small Add Card button).
 */
import type { ReactNode } from 'react'

export function AppHeader({ action }: { action?: ReactNode }) {
  return (
    <header className="app-header">
      <p className="app-header__title">Loyalty Card</p>
      {action}
    </header>
  )
}
