import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';
import { base, version, appName, buildInfo } from './build.config.js';

/** @type {import('vite').UserConfig} */
export default {
  define: {
    // Expose package version at build time — accessed in components as __APP_VERSION__
    __APP_VERSION__: JSON.stringify(version),
    __APP_BASE__: JSON.stringify(base),
    __APP_NAME__: JSON.stringify(appName),
    __APP_COMMIT__: JSON.stringify(buildInfo.commit),
  },
  plugins: [
    // Order matters: tailwind must come before sveltekit
    tailwindcss(),
    sveltekit(),
    {
      name: 'build-info',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'build-info.json', source: JSON.stringify(buildInfo) + '\n' });
      },
    },
    SvelteKitPWA({
      base: `${base}/`,
      scope: `${base}/`,
      kit: { trailingSlash: 'always' },
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
        id: `${base}/`,
        name: appName,
        short_name: appName,
        description: 'Track business expenses and mileage across multiple LLCs',
        start_url: `${base}/`,
        scope: `${base}/`,
        display: 'standalone',
        background_color: '#0f172a',
        theme_color: '#0f172a',
        icons: [
          {
            src: `${base}/icon-192.png`,
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: `${base}/icon-512.png`,
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: `${base}/icon-512-maskable.png`,
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          }
        ],
        // Web Share Target (Android only): allows BizTrack to appear in the
        // Android share sheet when sharing a receipt PDF/image from another app.
        // iOS does not support Web Share Target.
        share_target: {
          action: `${base}/share/`,
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
