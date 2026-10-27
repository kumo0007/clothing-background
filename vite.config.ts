import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Do not set Cross-Origin-Embedder-Policy: require-corp here — it blocks
  // Hugging Face CDN model fetches used by bg-remove-sdk / transformers.js
  // unless every asset sends Cross-Origin-Resource-Policy.
  server: {
    // `npm run dev -- --host` prints VPN/LAN IPs (e.g. Astrill 198.18.x).
    // Vite 6+ blocks unknown Host headers unless allowedHosts is open.
    host: true,
    allowedHosts: true,
  },
  build: {
    // Explicit modern-evergreen target (includes current Firefox modules).
    // Auto-mask still needs Worker + OffscreenCanvas (SDK); UI must boot without them.
    target: ['es2022', 'firefox105', 'chrome105', 'safari16.4', 'edge105'],
  },
  optimizeDeps: {
    include: [
      'bg-remove-sdk',
      '@huggingface/transformers',
      // Legacy audit scripts may still import these:
      '@imgly/background-removal',
      'onnxruntime-web',
    ],
  },
  worker: {
    format: 'es',
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    css: true,
  },
})
