import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // `npm run dev` serves the page; `npm run dev:server` runs the fight. The proxy keeps them on
  // one origin so the browser code is identical in development and in the container.
  server: {
    proxy: {
      '/ws': { target: 'ws://localhost:8080', ws: true },
    },
  },
})
