import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // SharedArrayBuffer for onnxruntime-web threads (ISNet). Without these,
  // ORT falls back / can stall while loading large WASM models.
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  optimizeDeps: {
    // Pre-bundle ISNet browser path so Batch → ISNet does not fail with a bare
    // module resolution error when the strategy is selected in the UI.
    include: ['@imgly/background-removal', 'onnxruntime-web'],
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    css: true,
  },
})
