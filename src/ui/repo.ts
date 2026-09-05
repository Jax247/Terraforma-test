/**
 * Where custom decks and boards live.
 *
 * Two implementations behind one async interface:
 *
 * - `ServerRepo` — the account's content, so a deck built on one machine is playable on
 *   another. Used whenever the API is reachable.
 * - `LocalRepo` — localStorage, exactly as before. Used when it is not, which is a real case
 *   rather than a defensive one: `npm run dev` without `npm run server` has no API behind it.
 *
 * The interface is async even for the local case on purpose. Making the call sites async once,
 * against a backend that cannot fail for network reasons, is much easier than doing it during
 * a server migration where every new bug has two possible causes.
 *
 * Collections are read and written WHOLE, because that is what the UI does — the deck builder
 * hands back a complete list. Each write carries the version it was based on so a stale device
 * cannot delete a deck it never saw; see `RepoConflict`.
 */
import { loadBoards, loadDecks, saveBoards, saveDecks } from './storage';
import type { StoredBoard, StoredDeck } from './storage';

export interface Snapshot<T> {
  items: T[];
  version: number;
}

/** A write refused because someone else moved first. `current` is the truth to rebase onto. */
export interface RepoConflict<T> {
  conflict: true;
  current: Snapshot<T>;
}

export const isRepoConflict = <T>(r: Snapshot<T> | RepoConflict<T>): r is RepoConflict<T> => 'conflict' in r;

export interface ContentRepo {
  /** Which backend answered, so the UI can be honest about whether anything is syncing. */
  readonly kind: 'server' | 'local';
  load(): Promise<{ decks: Snapshot<StoredDeck>; boards: Snapshot<StoredBoard> }>;
  putDecks(items: StoredDeck[], version: number): Promise<Snapshot<StoredDeck> | RepoConflict<StoredDeck>>;
  putBoards(items: StoredBoard[], version: number): Promise<Snapshot<StoredBoard> | RepoConflict<StoredBoard>>;
}

/** localStorage. Versions are inert here — there is only ever one writer. */
export class LocalRepo implements ContentRepo {
  readonly kind = 'local';

  load(): Promise<{ decks: Snapshot<StoredDeck>; boards: Snapshot<StoredBoard> }> {
    return Promise.resolve({
      decks: { items: loadDecks(), version: 0 },
      boards: { items: loadBoards(), version: 0 },
    });
  }

  putDecks(items: StoredDeck[]): Promise<Snapshot<StoredDeck>> {
    saveDecks(items);
    return Promise.resolve({ items, version: 0 });
  }

  putBoards(items: StoredBoard[]): Promise<Snapshot<StoredBoard>> {
    saveBoards(items);
    return Promise.resolve({ items, version: 0 });
  }
}

interface WireCollection {
  items: unknown[];
  version: number;
}

export class ServerRepo implements ContentRepo {
  readonly kind = 'server';

  async load(): Promise<{ decks: Snapshot<StoredDeck>; boards: Snapshot<StoredBoard> }> {
    const res = await fetch('/api/content');
    if (!res.ok) throw new Error(`content load failed: ${res.status}`);
    const body = (await res.json()) as { decks: WireCollection; boards: WireCollection };
    return {
      decks: { items: body.decks.items as StoredDeck[], version: body.decks.version },
      boards: { items: body.boards.items as StoredBoard[], version: body.boards.version },
    };
  }

  private async put<T>(path: string, items: T[], version: number): Promise<Snapshot<T> | RepoConflict<T>> {
    const res = await fetch(path, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items, version }),
    });
    if (res.status === 409) {
      const body = (await res.json()) as { current: WireCollection };
      return { conflict: true, current: { items: body.current.items as T[], version: body.current.version } };
    }
    if (!res.ok) throw new Error(`content save failed: ${res.status}`);
    const body = (await res.json()) as WireCollection;
    return { items: body.items as T[], version: body.version };
  }

  putDecks(items: StoredDeck[], version: number) {
    return this.put('/api/content/decks', items, version);
  }

  putBoards(items: StoredBoard[], version: number) {
    return this.put('/api/content/boards', items, version);
  }
}

/**
 * Pick a backend by asking the API whether it is really there. One GET at startup beats
 * guessing from `import.meta.env.DEV`, which would be wrong in both directions — a dev server
 * with the relay running does have an API, and a broken deploy does not.
 *
 * ⚠ A 200 is not enough. An SPA fallback answers ANY unmatched path with index.html and a
 * 200, so `res.ok` alone reports an API wherever one is merely absent — which is exactly the
 * `npm run dev` case with no relay behind it. Checking the content-type is what tells a real
 * JSON API apart from a page pretending to be one, and it is the difference between falling
 * back quietly and showing the player an error that is not true.
 */
export async function detectRepo(): Promise<ContentRepo> {
  try {
    const res = await fetch('/api/content', { method: 'GET' });
    if (res.ok && (res.headers.get('content-type') ?? '').includes('application/json')) return new ServerRepo();
  } catch {
    /* no API reachable at all */
  }
  return new LocalRepo();
}
