import { defineConfig } from 'vite';

// Must match the GitHub repo name so built asset URLs resolve correctly at
// https://<username>.github.io/arabic-tutor/
export default defineConfig({
  base: '/arabic-tutor/',
});
