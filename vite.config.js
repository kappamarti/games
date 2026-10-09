import { defineConfig } from 'vite';

// Percorsi relativi: la build funziona anche in una sottocartella (es. GitHub Pages /games/)
export default defineConfig({
  base: './',
  build: { chunkSizeWarningLimit: 2000 },
});
