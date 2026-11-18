import {iwsdkDev} from '@iwsdk/vite-plugin-dev';
import {defineConfig} from 'vite';

export default defineConfig({
  plugins: [
    iwsdkDev({
      // Default to HTTP on port 3000 for AI Studio / proxy compatibility;
      // pass VITE_HTTPS=true when serving directly to a physical Quest over LAN.
      https: process.env.VITE_HTTPS === 'true',
      bundle: {
        icons: 'all',
      },
    }),
  ],
  server: {
    host: '0.0.0.0',
    port: 3000,
    open: false,
  },
  build: {
    outDir: 'dist',
    sourcemap: process.env.NODE_ENV !== 'production',
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
