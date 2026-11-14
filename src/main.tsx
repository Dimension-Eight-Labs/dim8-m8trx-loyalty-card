/**
 * Browser entry point: loads global styles, chooses the storage
 * implementation, and mounts the application.
 *
 * The IndexedDB repository is constructed here, not inside App, so App and the
 * card feature depend only on the CardRepository interface.
 *
 * Service-worker registration is injected into index.html by vite-plugin-pwa
 * (see vite.config.ts), so nothing PWA-specific happens here.
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App.tsx'
import { createIndexedDbCardRepository } from './data/indexedDbCardRepository.ts'
import './styles/tokens.css'
import './styles/base.css'
import './styles/app.css'

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Root element #root is missing from index.html')
}

const repository = createIndexedDbCardRepository()

createRoot(rootElement).render(
  <StrictMode>
    <App repository={repository} />
  </StrictMode>,
)
