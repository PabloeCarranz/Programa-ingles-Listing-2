import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Puertos: 5174 (pantalla) y 8002 (backend) salvo que se cambien con FRONT_PORT / LISTENING_PORT (ver iniciar.bat)
const BACK = process.env.LISTENING_PORT || 8002

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.FRONT_PORT || 5174),
    proxy: {
      '/api':    { target: `http://localhost:${BACK}`, timeout: 0 },
      '/videos': { target: `http://localhost:${BACK}`, timeout: 0 },
      '/ws':     { target: `ws://localhost:${BACK}`, ws: true },
    }
  }
})
