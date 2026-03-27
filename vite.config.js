import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';

/** @type {import('vite').UserConfig} */
export default {
  plugins: [
    // Order matters: tailwind must come before sveltekit
    tailwindcss(),
    sveltekit(),
    SvelteKitPWA({
      registerType: 'autoUpdate',
      // injectManifest: custom sw.js handles Web Share Target (Phase 9.4).
      // Workbox precache manifest is injected at build time via self.__WB_MANIFEST.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'service-worker.js',
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}']
      },
      manifest: {
        name: 'BizTrack Expense Tracker',
        short_name: 'BizTrack',
        description: 'Track business expenses and mileage across multiple LLCs',
        start_url: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#0f172a',
        icons: [
          {
            src: '/icon-192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: '/icon-512.png',
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: '/icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          }
        ],
        // Web Share Target (Android only): allows BizTrack to appear in the
        // Android share sheet when sharing a receipt PDF/image from another app.
        // iOS does not support Web Share Target.
        share_target: {
          action: '/share',
          method: 'POST',
          enctype: 'multipart/form-data',
          params: {
            files: [
              {
                name: 'receipt',
                accept: ['image/*', 'application/pdf']
              }
            ]
          }
        }
      },
      devOptions: {
        // Enable PWA in dev mode for testing manifest + SW behavior
        enabled: false
      }
    })
  ]
};
