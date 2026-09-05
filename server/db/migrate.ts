/**
 * Numbered-SQL migration runner. No ORM, no framework — the schema is two tables.
 *
 * Runs at boot rather than as a separate deploy step: a PaaS pre-deploy hook is one more
 * thing to configure and get wrong, and the advisory lock below makes boot-time migration
 * safe even when a rolling deploy has two instances starting at once.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Pool } from 'pg';

const DIR = join(import.meta.dirname, 'migrations');
/** Any 64-bit constant; it only has to be the same in every instance. */
const LOCK_KEY = 0x7e44a301;

export async function migrate(pool: Pool): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query(
      `create table if not exists schema_migrations (
         version    integer primary key,
         applied_at timestamptz not null default now()
       )`,
    );
    // Serialises concurrent boots. Released explicitly below, and by the session ending.
    await client.query('select pg_advisory_lock($1)', [LOCK_KEY]);
    try {
      const done = new Set(
        (await client.query<{ version: number }>('select version from schema_migrations')).rows.map(
          (r) => r.version,
        ),
      );
      const files = (await readdir(DIR))
        .map((f) => ({ f, m: /^(\d+)_.*\.sql$/.exec(f) }))
        .filter((x): x is { f: string; m: RegExpExecArray } => x.m !== null)
        .map((x) => ({ file: x.f, version: Number(x.m[1]) }))
        .sort((a, b) => a.version - b.version);

      let applied = 0;
      for (const { file, version } of files) {
        if (done.has(version)) continue;
        const sql = await readFile(join(DIR, file), 'utf8');
        // Each migration is one transaction: a half-applied schema is worse than none.
        await client.query('begin');
        try {
          await client.query(sql);
          await client.query('insert into schema_migrations (version) values ($1)', [version]);
          await client.query('commit');
          console.log(`[migrate] applied ${file}`);
          applied++;
        } catch (e) {
          await client.query('rollback');
          throw e;
        }
      }
      return applied;
    } finally {
      await client.query('select pg_advisory_unlock($1)', [LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}
