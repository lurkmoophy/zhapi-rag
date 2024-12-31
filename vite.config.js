// vite.config.js
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'public', // Set the root directory for Vite
  build: {
    outDir: '../dist', // Output directory for Netlify
  },
});
