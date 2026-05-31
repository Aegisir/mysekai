import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';

import { fileURLToPath } from 'node:url';

const srcPath = fileURLToPath(new URL('./src', import.meta.url));

export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? '/mysekai/' : '/',
  plugins: [solid()],
  resolve: {
    alias: {
      '@': srcPath,
    },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 640,
    cssCodeSplit: true,
    modulePreload: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/@esotericsoftware')) {
            return 'spine';
          }

          if (id.includes('node_modules/pixi.js')) {
            return 'pixi';
          }

          if (id.includes('node_modules/solid-js')) {
            return 'solid';
          }

          return undefined;
        },
      },
    },
  },
});
