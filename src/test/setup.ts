/**
 * Shared Vitest setup: registers jest-dom matchers (toBeInTheDocument, etc.)
 * and unmounts rendered components after each test so tests stay isolated.
 */
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(() => {
  cleanup()
})
