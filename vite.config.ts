import fs from 'node:fs';
import path from 'node:path';
import {iwsdkDev} from '@iwsdk/vite-plugin-dev';
import {type Plugin, defineConfig} from 'vite';

// In headless container environments (no display server), skip launching
// IWSDK's managed headed Chromium browser on dev server startup unless requested.
if (
  !process.env.DISPLAY &&
  !process.env.WAYLAND_DISPLAY &&
  process.env.IWSDK_DEV_OPEN == null
) {
  process.env.IWSDK_DEV_OPEN = 'false';
}

const VIRTUAL_UIKITML_ID = 'virtual:rollox-uikitml';
const RESOLVED_VIRTUAL_UIKITML_ID = `\0${VIRTUAL_UIKITML_ID}`;

/**
 * Ensures UIKitML panel sources are never rejected by IWSDK's AssetManager when
 * dev servers, Cloud Run reverse proxies, or static hosts omit or MIME-sniff
 * the unknown `.uikitml` extension as `text/html`.
 */
function rolloxUikitmlPlugin(): Plugin {
  const uiDir = path.resolve(process.cwd(), 'public/ui');

  const applyUikitmlHeaders = (
    req: {url?: string},
    res: {setHeader: (name: string, value: string) => void},
    next: () => void
  ): void => {
    const pathname = (req.url ?? '').split('?')[0];
    if (pathname.endsWith('.uikitml')) {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('X-Content-Type-Options', 'nosniff');
    }
    next();
  };

  return {
    name: 'rollox-uikitml-mime-and-bundle',
    resolveId(id) {
      if (id === VIRTUAL_UIKITML_ID) {
        return RESOLVED_VIRTUAL_UIKITML_ID;
      }
      return null;
    },
    load(id) {
      if (id !== RESOLVED_VIRTUAL_UIKITML_ID) return null;
      const entries: Record<string, string> = {};
      if (fs.existsSync(uiDir)) {
        for (const file of fs.readdirSync(uiDir).sort()) {
          if (!file.endsWith('.uikitml')) continue;
          const fullPath = path.join(uiDir, file);
          this.addWatchFile(fullPath);
          entries[file] = fs.readFileSync(fullPath, 'utf8');
        }
      }
      return `export default ${JSON.stringify(entries)};`;
    },
    configureServer(server) {
      server.middlewares.use(applyUikitmlHeaders);
    },
    configurePreviewServer(server) {
      server.middlewares.use(applyUikitmlHeaders);
    },
  };
}

export default defineConfig({
  plugins: [
    rolloxUikitmlPlugin(),
    iwsdkDev({
      // Default to HTTP on port 3000 for AI Studio / proxy compatibility;
      // pass VITE_HTTPS=true when serving directly to a physical Quest over LAN.
      https: process.env.VITE_HTTPS === 'true',
    }),
  ],
  server: {
    host: '0.0.0.0',
    port: 3000,
    open: false,
  },
  build: {
    outDir: 'dist',
    sourcemap: process.env.VITE_SOURCEMAP === 'true',
    target: 'esnext',
    rollupOptions: {
      input: './index.html',
    },
  },
  esbuild: {
    target: 'esnext',
  },
  resolve: {
    dedupe: [
      'three',
      '@pmndrs/uikit',
      '@pmndrs/uikit-horizon',
      '@pmndrs/uikit-lucide',
    ],
  },
  optimizeDeps: {
    exclude: ['@babylonjs/havok'],
    include: [
      'three',
      '@pmndrs/uikit',
      '@pmndrs/uikit-horizon',
      '@pmndrs/uikit-lucide',
      '@drawcall/uikitml',
      '@dimforge/rapier3d-simd-compat',
    ],
    esbuildOptions: {
      target: 'esnext',
    },
  },
  publicDir: 'public',
  base: './',
});
