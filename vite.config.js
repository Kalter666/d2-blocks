import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  // GitHub Pages serves project sites under /<repo>/. Override for a custom domain.
  base: process.env.BASE_PATH ?? '/d2-editor/',
  plugins: [svelte()],
  worker: { format: 'es' },
});
