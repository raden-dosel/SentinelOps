import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';
import { defineConfig } from 'vite';

function suppressHmrWebSocketPlugin() {
  return {
    name: 'suppress-hmr-websocket',
    enforce: 'post' as const,
    transform(code: string, id: string) {
      if (id.includes('client.mjs') || id.includes('/@vite/client')) {
        let modified = code;
        // Make connect(handlers) a clean no-op so no WebSocket attempt occurs
        modified = modified.replace(
          /async\s+connect\(handlers\)\s*\{/g,
          'async connect(handlers) { return;'
        );
        modified = modified.replace(
          /send\(data\)\s*\{\s*wsTransport\.send\(data\);\s*\}/g,
          'send(data) { try { wsTransport?.send?.(data); } catch {} }'
        );
        modified = modified.replace(
          /console\.error\(\s*`\[vite\] failed to connect to websocket[\s\S]*?\`\s*\);/g,
          '/* [vite] websocket connection suppressed */'
        );
        modified = modified.replace(
          /console\.info\(\s*"\[vite\] Direct websocket connection fallback[\s\S]*?"\s*\);/g,
          '/* [vite] websocket fallback suppressed */'
        );
        return modified;
      }
      return null;
    },
  };
}

export default defineConfig(({ command }) => {
  const isDev = command === 'serve';

  return {
    plugins: [
      react(),
      tailwindcss(),
      suppressHmrWebSocketPlugin(),
      ...(!isDev
        ? [
            VitePWA({
              injectRegister: null,
              registerType: 'prompt',
              includeAssets: ['icons/*.png'],
              manifest: {
                id: './',
                name: 'SentinelOps — Business Operations Management System',
                short_name: 'SentinelOps',
                description: 'Offline-first business operations management for security installation services.',
                theme_color: '#0f172a',
                background_color: '#0f172a',
                display: 'standalone',
                orientation: 'any',
                start_url: './',
                scope: './',
                icons: [
                  {
                    src: 'icons/icon-192.png',
                    sizes: '192x192',
                    type: 'image/png',
                    purpose: 'any',
                  },
                  {
                    src: 'icons/icon-512.png',
                    sizes: '512x512',
                    type: 'image/png',
                    purpose: 'any',
                  },
                  {
                    src: 'icons/icon-maskable-512.png',
                    sizes: '512x512',
                    type: 'image/png',
                    purpose: 'maskable',
                  },
                ],
              },
              workbox: {
                maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
                globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
                cleanupOutdatedCaches: true,
                navigateFallback: 'index.html',
              },
            }),
          ]
        : []),
    ],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, './src'),
        'virtual:pwa-register/react': path.resolve(import.meta.dirname, './src/hooks/useRegisterSW.ts'),
        'virtual:pwa-register': path.resolve(import.meta.dirname, './src/hooks/useRegisterSW.ts'),
      },
    },
    server: {
      port: 3000,
      host: '0.0.0.0',
      hmr: false as const,
    },
  };
});
