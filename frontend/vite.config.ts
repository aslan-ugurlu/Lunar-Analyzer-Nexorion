/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Dev server: http://localhost:5173. The backend allows only the two localhost
// dev origins via CORS; alternatively set VITE_API_BASE_URL=/api to use this proxy.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: 'localhost',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 5000, // plotly.js-dist-min is a single ~4.6 MB lazily loaded chunk
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    env: { TZ: 'America/Los_Angeles' }, // proves UTC handling does not depend on local zone
  },
});
