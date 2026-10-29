import { defineConfig } from 'vite';

// Relative base so the build works on GitHub Pages under /<repo>/ as well as locally.
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
    sourcemap: false
  },
  server: { host: true }
});
