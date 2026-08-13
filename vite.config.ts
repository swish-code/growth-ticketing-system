import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'client',
  plugins: [react()],
  build: {
    outDir: '../dist/client',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      // Regex, not a prefix: a plain '/api' key also swallows the client's own
      // /api.ts module request in dev.
      '^/api/': 'http://localhost:8080',
    },
  },
});
