/**
 * Per-account custom decks and boards.
 *
 * The server stays rules-agnostic here as everywhere else: a deck is opaque JSON it hands
 * back unchanged. It never validates a decklist, because doing so would couple deployments to
 * RULES changes for no gain — `validateDeck` already runs client-side where the pool lives.
 */

/** A collection plus the version it was read at. */
export interface Versioned {
  items: unknown[];
  version: number;
}

export interface Content {
  decks: Versioned;
  boards: Versioned;
}

export const EMPTY_CONTENT: Content = { decks: { items: [], version: 0 }, boards: { items: [], version: 0 } };

export type Collection = 'decks' | 'boards';

/** Refused because the caller's version was stale; carries the current state to merge from. */
export interface Conflict {
  conflict: true;
  current: Versioned;
}

export interface ContentStore {
  get(userId: string): Promise<Content>;
  /**
   * Replace one collection whole. `expectedVersion` must match what the caller read, or the
   * write is refused — see the migration for why a blind overwrite loses data.
   */
  put(
    userId: string,
    collection: Collection,
    items: unknown[],
    expectedVersion: number,
  ): Promise<Versioned | Conflict>;
}

export const isConflict = (r: Versioned | Conflict): r is Conflict => 'conflict' in r;

export class MemoryContentStore implements ContentStore {
  private byUser = new Map<string, Content>();

  get(userId: string): Promise<Content> {
    return Promise.resolve(structuredClone(this.byUser.get(userId) ?? EMPTY_CONTENT));
  }

  put(
    userId: string,
    collection: Collection,
    items: unknown[],
    expectedVersion: number,
  ): Promise<Versioned | Conflict> {
    const current = this.byUser.get(userId) ?? structuredClone(EMPTY_CONTENT);
    if (current[collection].version !== expectedVersion) {
      return Promise.resolve({ conflict: true, current: structuredClone(current[collection]) });
    }
    const next: Versioned = { items: structuredClone(items), version: expectedVersion + 1 };
    this.byUser.set(userId, { ...current, [collection]: next });
    return Promise.resolve(structuredClone(next));
  }
}
