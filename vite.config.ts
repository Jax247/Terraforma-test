import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // let LAN playtesters hit the dev server
    proxy: {
      '/ws': { target: 'ws://localhost:8787', ws: true, changeOrigin: true },
    },
  },
  test: {
    environment: 'node',
    include: ['{src,server}/**/tests/**/*.test.ts'],
  },
});
