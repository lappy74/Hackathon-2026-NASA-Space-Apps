import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

// Local version of the Figma Make config: the Figma-only preview plugins are removed.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    // Requests to /api/... go to the Python backend (Flask/FastAPI on port 8000).
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
})
