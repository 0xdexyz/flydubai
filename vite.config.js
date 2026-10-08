import { defineConfig } from 'vite';

// Relative base so the production build can be hosted from any folder.
export default defineConfig({
  base: './',
  server: {
    port: 5204,
    strictPort: true,
    // Online service (pilot names + live leaderboard), see server/index.mjs.
    // xfwd passes the real client address on, so owner-only routes can refuse other devices.
    proxy: { '/api': { target: 'http://localhost:8791', changeOrigin: true, xfwd: true } },
  },
  preview: { proxy: { '/api': { target: 'http://localhost:8791', changeOrigin: true, xfwd: true } } },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 900,
  },
});
