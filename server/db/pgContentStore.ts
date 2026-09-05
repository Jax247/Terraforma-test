/**
 * Postgres-backed ContentStore.
 *
 * The version check is done IN the update's where-clause rather than as a read-then-write, so
 * two devices racing cannot both pass the check and clobber each other. A zero-row result is
 * the conflict signal.
 */
import type pg from 'pg';
import type { Collection, Conflict, Content, ContentStore, Versioned } from '../content.ts';
import { EMPTY_CONTENT } from '../content.ts';

interface ContentRow {
  decks: unknown[];
  decks_version: number;
  boards: unknown[];
  boards_version: number;
}

export class PgContentStore implements ContentStore {
  private pool: pg.Pool;

  constructor(pool: pg.Pool) {
    this.pool = pool;
  }

  async get(userId: string): Promise<Content> {
    const r = await this.pool.query<ContentRow>(
      'select decks, decks_version, boards, boards_version from user_content where user_id = $1',
      [userId],
    );
    const row = r.rows[0];
    if (!row) return structuredClone(EMPTY_CONTENT);
    return {
      decks: { items: row.decks ?? [], version: row.decks_version },
      boards: { items: row.boards ?? [], version: row.boards_version },
    };
  }

  async put(
    userId: string,
    collection: Collection,
    items: unknown[],
    expectedVersion: number,
  ): Promise<Versioned | Conflict> {
    const col = collection === 'decks' ? 'decks' : 'boards';
    const verCol = `${col}_version`;

    // Insert-or-update in one statement. The `where` on the conflict branch is what makes the
    // version check atomic; `where excluded.<ver> = 0` keeps a first-ever write from silently
    // overwriting a row that already exists at a later version.
    const r = await this.pool.query<{ version: number }>(
      `insert into user_content (user_id, ${col}, ${verCol}, updated_at)
       values ($1, $2::jsonb, 1, now())
       on conflict (user_id) do update
         set ${col} = excluded.${col}, ${verCol} = user_content.${verCol} + 1, updated_at = now()
         where user_content.${verCol} = $3
       returning ${verCol} as version`,
      [userId, JSON.stringify(items), expectedVersion],
    );

    if (r.rows[0]) return { items, version: r.rows[0].version };

    // No row updated: either the version was stale, or the insert hit an existing row whose
    // version is not what the caller expected. Either way, hand back the truth.
    const current = await this.get(userId);
    return { conflict: true, current: current[collection] };
  }
}
