/**
 * One pool, one migration run, both stores.
 *
 * Rooms and users share a connection pool deliberately: this is a single process serving
 * turn-based traffic, and two pools would only hold twice as many idle connections against
 * the small limits managed Postgres plans ship with.
 */
import pg from 'pg';
import { migrate } from './migrate.ts';
import { PgRoomStore } from './pgStore.ts';
import { PgUserStore } from './pgUserStore.ts';
import { PgContentStore } from './pgContentStore.ts';

const { Pool } = pg;

/**
 * Whether to offer TLS to the database.
 *
 * Managed Postgres presents a cert the container has no CA for, so verification is off — but
 * the connection still has to be attempted over TLS or the server refuses it outright. Keying
 * this on the literal string `sslmode=require` was too narrow: Render and Railway both hand
 * out URLs without that parameter, and the resulting connection failure happens at boot,
 * which used to take the whole app down with it.
 *
 * Local development is the case that must NOT use TLS — a plain postgres container has none.
 */
function needsSsl(url: string): boolean {
  if (/sslmode=(disable|allow)/.test(url)) return false;
  if (/sslmode=require|sslmode=verify/.test(url)) return true;
  try {
    const host = new URL(url).hostname;
    // Anything not obviously on this machine or a private container network is remote, and
    // every managed provider worth naming requires TLS.
    return !(
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host.endsWith('.internal') ||
      host.endsWith('.local')
    );
  } catch {
    return false;
  }
}

export async function createPgStores(connectionString: string): Promise<{
  rooms: PgRoomStore;
  users: PgUserStore;
  content: PgContentStore;
}> {
  const pool = new Pool({
    connectionString,
    max: 4,
    ssl: needsSsl(connectionString) ? { rejectUnauthorized: false } : undefined,
  });
  await migrate(pool);
  return { rooms: new PgRoomStore(pool), users: new PgUserStore(pool), content: new PgContentStore(pool) };
}
