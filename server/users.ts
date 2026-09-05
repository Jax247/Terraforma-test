/**
 * Account storage, in the same shape as the room store: a small interface with an in-memory
 * double, so nothing here forces a database on a local `npm run server`.
 *
 * Unlike RoomStore these methods ARE async. Rooms are written on a hot path where ordering
 * matters and staleness is survivable; accounts are read on cold paths (an API call, a socket
 * upgrade) where the caller genuinely cannot proceed without the answer.
 */

export interface User {
  id: string;
  /** Null for a guest. Lowercased on the way in. */
  email: string | null;
  passwordHash: string | null;
  displayName: string;
}

export interface UserStore {
  create(user: User): Promise<void>;
  byId(id: string): Promise<User | undefined>;
  byEmail(email: string): Promise<User | undefined>;
  /** Attach credentials to an existing row, or rename. Only the given fields change. */
  update(id: string, patch: Partial<Pick<User, 'email' | 'passwordHash' | 'displayName'>>): Promise<void>;
  touch(id: string): void;
}

export class MemoryUserStore implements UserStore {
  private users = new Map<string, User>();

  create(user: User): Promise<void> {
    this.users.set(user.id, { ...user });
    return Promise.resolve();
  }

  byId(id: string): Promise<User | undefined> {
    const u = this.users.get(id);
    return Promise.resolve(u && { ...u });
  }

  byEmail(email: string): Promise<User | undefined> {
    for (const u of this.users.values()) if (u.email === email) return Promise.resolve({ ...u });
    return Promise.resolve(undefined);
  }

  update(id: string, patch: Partial<Pick<User, 'email' | 'passwordHash' | 'displayName'>>): Promise<void> {
    const u = this.users.get(id);
    if (u) this.users.set(id, { ...u, ...patch });
    return Promise.resolve();
  }

  touch(_id: string): void {
    // Last-seen is a nicety, not state anything depends on.
  }
}
