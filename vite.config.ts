import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// base './' — сборка работает и на GitHub Pages (в подпапке), и на Vercel.
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  server: { port: 5173, host: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
})
