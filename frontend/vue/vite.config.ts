import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
  plugins: [
    vue({
      template: {
        // Don't try to resolve absolute URL asset references — they are served
        // at runtime by FastAPI (/assets/*, /frontend/*).
        transformAssetUrls: {
          // Disable default asset URL transforms for img src, link href etc.
          img: [],
          link: [],
          video: [],
          source: [],
        },
      },
    }),
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8001',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:8001',
        ws: true,
      },
      '/assets': {
        target: 'http://localhost:8001',
        changeOrigin: true,
      },
      '/frontend': {
        target: 'http://localhost:8001',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: '../../frontend/spa-dist',
    emptyOutDir: true,
    // Output JS/CSS bundles under /spa-assets/ to avoid clashing with the
    // /assets/ static mount (map tiles, PMTiles, sprites) served by FastAPI.
    assetsDir: 'spa-assets',
  },
})
