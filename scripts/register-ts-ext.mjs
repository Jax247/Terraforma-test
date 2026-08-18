// Lets `node` load the engine's extensionless relative imports (e.g. `../../board`)
// under native TypeScript. The app runs through Vite, which resolves these;
// standalone scripts that import engine runtime values need this shim. Built-ins
// only — no dependencies. Use via:
//   node --import ./scripts/register-ts-ext.mjs scripts/genCardArt.ts
import { registerHooks } from 'node:module';
import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

registerHooks({
  resolve(specifier, context, nextResolve) {
    const bare = specifier.startsWith('.') && !/\.(ts|tsx|js|mjs|cjs|json)$/.test(specifier);
    if (bare && context.parentURL) {
      for (const ext of ['.ts', '/index.ts']) {
        try {
          statSync(fileURLToPath(new URL(specifier + ext, context.parentURL)));
          return nextResolve(specifier + ext, context);
        } catch { /* try next candidate */ }
      }
    }
    return nextResolve(specifier, context);
  },
});
