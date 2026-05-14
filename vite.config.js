import { defineConfig } from 'vite';

export default defineConfig({
  base: '/atlas-webxr-physics/',
  server: {
    host: '0.0.0.0',
    allowedHosts: true,
  },
  build: {
    outDir: 'dist',
  },
});
