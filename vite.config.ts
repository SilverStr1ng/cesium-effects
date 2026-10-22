import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  define: { CESIUM_BASE_URL: JSON.stringify('cesium/') },
  server: { watch: { ignored: ['**/artifacts/**', '**/docs/**', '**/public/cesium/**'] } },
  build: { chunkSizeWarningLimit: 1600 },
});
