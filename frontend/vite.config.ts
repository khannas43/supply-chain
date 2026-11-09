import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    strictPort: true,
    // the API from `docker compose up`, so the dev server can use it later
    proxy: { '/api': 'http://127.0.0.1:8100' },
  },
})
