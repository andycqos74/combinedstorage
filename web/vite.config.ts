import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The API server port (see server .env). Vite proxies /api and /f to it in dev
// so the browser only ever talks to the Vite origin (keeps session cookies simple).
const API_TARGET = process.env.API_TARGET || 'http://localhost:4000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
      '/f': { target: API_TARGET, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
  },
});
