import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * SPIKE (throwaway) — lets the 3D board's dial panel write itself back to disk.
 *
 * The panel's settings live in localStorage, which nobody but that browser can
 * read. Hitting "lock in as default" POSTs the current dials here and they land in
 * `src/ui/spike3d.defaults.json`, which the panel imports as its defaults — so the
 * configuration someone actually settled on becomes the one everybody opens with,
 * and is reviewable in the diff rather than trapped in a browser profile.
 *
 * `apply: 'serve'` — dev only. A production build has no write endpoint at all.
 * The payload is validated against the KEYS AND TYPES already in the file rather
 * than written through, so this cannot be used to put arbitrary content on disk.
 *
 * TO REVERT: delete this plugin, its entry in `plugins`, and the JSON file.
 */
function spike3dDefaults(): Plugin {
  const FILE = path.resolve(process.cwd(), 'src/ui/spike3d.defaults.json');
  return {
    name: 'spike3d-defaults',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__spike3d/defaults', (req, res, next) => {
        if (req.method !== 'POST') return next();
        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
          if (body.length > 4096) req.destroy(); // a dial set is a few hundred bytes
        });
        req.on('end', () => {
          void (async () => {
            try {
              const sent = JSON.parse(body) as Record<string, unknown>;
              const current = JSON.parse(await readFile(FILE, 'utf8')) as Record<string, unknown>;
              const out: Record<string, unknown> = {};
              for (const key of Object.keys(current)) {
                const v = sent[key];
                if (typeof v !== typeof current[key]) throw new Error(`bad or missing "${key}"`);
                if (typeof v === 'number' && !Number.isFinite(v)) throw new Error(`"${key}" is not finite`);
                out[key] = v;
              }
              await writeFile(FILE, `${JSON.stringify(out, null, 2)}\n`);
              res.statusCode = 200;
              res.end('ok');
            } catch (err) {
              res.statusCode = 400;
              res.end(String(err));
            }
          })();
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), spike3dDefaults()],
  server: {
    host: true, // let LAN playtesters hit the dev server
    proxy: {
      '/ws': { target: 'ws://localhost:8787', ws: true, changeOrigin: true },
      // Without this the account and content APIs 404 through Vite, and the client silently
      // drops to its localStorage fallback — which looks exactly like sync being broken.
      '/api': { target: 'http://localhost:8787', changeOrigin: true },
    },
  },
  test: {
    environment: 'node',
    include: ['{src,server}/**/tests/**/*.test.ts'],
  },
});
