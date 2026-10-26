import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AppErrorBoundary } from './components/AppErrorBoundary'
import { checkBootCompat } from './lib/browser/bootCompat'

function showBootFailure(message: string): void {
  const root = document.getElementById('root')
  if (!root) return
  root.replaceChildren()
  const wrap = document.createElement('div')
  wrap.className = 'app-boot-error'
  wrap.setAttribute('role', 'alert')
  wrap.dataset.testid = 'app-boot-failure'
  const h1 = document.createElement('h1')
  h1.textContent = 'Unable to start Garment Background Studio'
  const p1 = document.createElement('p')
  p1.textContent = message
  const p2 = document.createElement('p')
  p2.textContent =
    'Try the latest Firefox, Chrome, Edge, or Safari. If the page stayed blank before, open the developer console (F12) and note any red errors.'
  wrap.append(h1, p1, p2)
  root.append(wrap)
}

try {
  const mount = document.getElementById('root')
  if (!mount) {
    throw new Error('Missing #root element in index.html.')
  }

  const compat = checkBootCompat()
  for (const warning of compat.warnings) {
    console.warn('[bootCompat]', warning)
  }
  if (!compat.ok) {
    showBootFailure(
      compat.warnings.join(' ') || 'Browser environment is not supported.',
    )
  } else {
    createRoot(mount).render(
      <StrictMode>
        <AppErrorBoundary>
          <App />
        </AppErrorBoundary>
      </StrictMode>,
    )
  }
} catch (err) {
  const message =
    err instanceof Error
      ? err.message
      : 'Unexpected startup failure while loading the application.'
  console.error('[boot]', message)
  showBootFailure(
    `Startup error: ${message}. This is separate from on-device model loading.`,
  )
}
