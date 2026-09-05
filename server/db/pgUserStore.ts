/**
 * Postgres-backed UserStore. Reads are awaited (callers cannot proceed without the answer);
 * `touch` is deliberately fire-and-forget, since last-seen is a nicety and must never add
 * latency to a request or fail one.
 */
import type pg from 'pg';
import type { User, UserStore } from '../users.ts';

interface UserRow {
  id: string;
  email: string | null;
  password_hash: string | null;
  display_name: string;
}

const toUser = (r: UserRow): User => ({
  id: r.id,
  email: r.email,
  passwordHash: r.password_hash,
  displayName: r.display_name,
});

export class PgUserStore implements UserStore {
  private pool: pg.Pool;

  constructor(pool: pg.Pool) {
    this.pool = pool;
  }

  async create(user: User): Promise<void> {
    await this.pool.query(
      `insert into users (id, email, password_hash, display_name) values ($1,$2,$3,$4)`,
      [user.id, user.email, user.passwordHash, user.displayName],
    );
  }

  async byId(id: string): Promise<User | undefined> {
    const r = await this.pool.query<UserRow>('select * from users where id = $1', [id]);
    return r.rows[0] ? toUser(r.rows[0]) : undefined;
  }

  async byEmail(email: string): Promise<User | undefined> {
    const r = await this.pool.query<UserRow>('select * from users where email = $1', [email]);
    return r.rows[0] ? toUser(r.rows[0]) : undefined;
  }

  async update(id: string, patch: Partial<Pick<User, 'email' | 'passwordHash' | 'displayName'>>): Promise<void> {
    const sets: string[] = [];
    const vals: unknown[] = [];
    // Built from whatever the caller actually passed, so a claim that only sets credentials
    // cannot accidentally blank a display name.
    if ('email' in patch) sets.push(`email = $${sets.length + 2}`), vals.push(patch.email ?? null);
    if ('passwordHash' in patch) sets.push(`password_hash = $${sets.length + 2}`), vals.push(patch.passwordHash ?? null);
    if ('displayName' in patch) sets.push(`display_name = $${sets.length + 2}`), vals.push(patch.displayName);
    if (!sets.length) return;
    await this.pool.query(`update users set ${sets.join(', ')} where id = $1`, [id, ...vals]);
  }

  touch(id: string): void {
    void this.pool
      .query('update users set last_seen_at = now() where id = $1', [id])
      .catch((e: unknown) => console.error('[users] touch failed:', e));
  }
}
