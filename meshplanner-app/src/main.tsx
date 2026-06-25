import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ilpMinSites } from '@/lib/optimize/ilp'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

/* ── E2E test helpers (exposed on window) ── */
if (typeof window !== 'undefined') {
  ;(window as any).__ilpMinSites = ilpMinSites
}
