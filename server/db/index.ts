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

const { Pool } = pg;

export async function createPgStores(connectionString: string): Promise<{
  rooms: PgRoomStore;
  users: PgUserStore;
}> {
  const pool = new Pool({
    connectionString,
    max: 4,
    // Managed Postgres presents a cert the container has no CA for.
    ssl: connectionString.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined,
  });
  await migrate(pool);
  return { rooms: new PgRoomStore(pool), users: new PgUserStore(pool) };
}
