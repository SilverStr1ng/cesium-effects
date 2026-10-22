import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  define: { CESIUM_BASE_URL: JSON.stringify('cesium/') },
  build: { chunkSizeWarningLimit: 1600 },
});
