/**
 * The server's window onto the engine — the ONE place that pulls engine runtime values
 * into `server/`.
 *
 * Two reasons it exists rather than importing `../src/engine/index.ts` all over:
 *
 * 1. Auditability. The relay was historically rules-agnostic (decks and actions were opaque
 *    JSON), and that is why tuning RULES never needed a server redeploy. As the server takes
 *    on validation and then authority, this file is the record of exactly how much of the
 *    engine it now depends on. Keep the list short and deliberate.
 * 2. It marks the type-stripping boundary. `server/` runs as TypeScript under Node, and the
 *    engine's relative imports are extensionless, so this only resolves because the process
 *    is started with `--import ./scripts/register-ts-ext.mjs` (see the `server` and `start`
 *    scripts). Anything imported here inherits that requirement.
 *
 * Value imports only — `import type` from src/ is free and does not belong here.
 */
export { changedRules, RULES } from '../src/engine/rules.ts';
