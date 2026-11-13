/**
 * Browser entry point: loads global styles and mounts the application.
 *
 * Service-worker registration is injected into index.html by vite-plugin-pwa
 * (see vite.config.ts), so nothing PWA-specific happens here.
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App.tsx'
import './styles/tokens.css'
import './styles/base.css'
import './styles/app.css'

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Root element #root is missing from index.html')
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
