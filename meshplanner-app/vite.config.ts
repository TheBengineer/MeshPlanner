import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { VitePWA } from 'vite-plugin-pwa'
import wasm from 'vite-plugin-wasm'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import { viteStaticCopy } from 'vite-plugin-static-copy'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    wasm(),
    nodePolyfills(),
    viteStaticCopy({
      targets: [
        {
          src: 'node_modules/highs/build/highs.wasm',
          dest: 'assets',
        },
      ],
    }),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        runtimeCaching: [
          {
            // DEM tiles from AWS Open Data: cache-first for offline use
            urlPattern: /^https:\/\/s3\.amazonaws\.com\/elevation-tiles-prod\/geotiff\/.*/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'dem-tiles',
              expiration: { maxEntries: 500, maxAgeSeconds: 30 * 24 * 60 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Map tiles: stale-while-revalidate
            urlPattern: /^https:\/\/[^/]+\.tile\.openstreetmap\.org\/.*/,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'map-tiles',
              expiration: { maxEntries: 200, maxAgeSeconds: 7 * 24 * 60 * 60 },
            },
          },
        ],
      },
      manifest: {
        name: 'MeshPlanner',
        short_name: 'MeshPlanner',
        description: 'LoRa Mesh Network Site Planner',
        theme_color: '#1a1a2e',
        background_color: '#1a1a2e',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
  optimizeDeps: {
    exclude: ['highs'],
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('maplibre-gl')) return 'maplibre'
          if (id.includes('react-dom') || id.includes('react/')) return 'react'
          if (id.includes('geotiff')) return 'geotiff'
        },
      },
    },
  },
  // test: config moved to vitest.workspace.ts
})
