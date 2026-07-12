import { defineConfig } from 'vite';

export default defineConfig({
  base: '/flop/',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 4096,
  },
  server: {
    port: 5173,
  },
});
