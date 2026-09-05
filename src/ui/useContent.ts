/**
 * Custom decks and boards, loaded from whichever backend is available.
 *
 * Replaces the synchronous `useStoredDecks` / `useStoredBoards`. The setters keep the old
 * `(next: T[]) => void` shape deliberately, so every consumer — DeckBuilder's `onSave`,
 * BoardEditor's, SetupScreen's reads — is untouched by the move to a server.
 *
 * Writes are optimistic: local state updates immediately and the request follows. A save that
 * is refused or fails puts a message in `error` rather than reverting, because silently
 * undoing someone's edit is worse than telling them it did not save.
 */
import { useCallback, useEffect, useState } from 'react';
import { detectRepo, isRepoConflict, LocalRepo } from './repo';
import type { ContentRepo, Snapshot } from './repo';
import { loadBoards, loadDecks } from './storage';
import type { StoredBoard, StoredDeck } from './storage';

/** Local content worth offering to import, counted once at first sync. */
export interface Importable {
  decks: number;
  boards: number;
}

export interface Content {
  /** False until the first load settles. Callers should not render editors before this. */
  ready: boolean;
  kind: 'server' | 'local';
  decks: StoredDeck[];
  boards: StoredBoard[];
  setDecks: (next: StoredDeck[]) => void;
  setBoards: (next: StoredBoard[]) => void;
  error: string;
  clearError: () => void;
  /** Set when this account is empty but the browser still holds content from before. */
  importable: Importable | null;
  importLocal: () => void;
  dismissImport: () => void;
}

export function useContent(): Content {
  const [repo, setRepo] = useState<ContentRepo>(() => new LocalRepo());
  const [ready, setReady] = useState(false);
  const [decks, setDecksState] = useState<Snapshot<StoredDeck>>({ items: [], version: 0 });
  const [boards, setBoardsState] = useState<Snapshot<StoredBoard>>({ items: [], version: 0 });
  const [error, setError] = useState('');
  const [importable, setImportable] = useState<Importable | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      const picked = await detectRepo();
      let loaded;
      try {
        loaded = await picked.load();
      } catch {
        // The API answered the probe but not the load. Rather than leave the app with no
        // decks at all, fall back to whatever this browser has.
        loaded = await new LocalRepo().load();
        if (live) setError('Could not reach your saved decks — showing this browser’s copy.');
      }
      if (!live) return;
      setRepo(picked);
      setDecksState(loaded.decks);
      setBoardsState(loaded.boards);

      // Offer a one-time import when the account is empty but the browser is not. Checked
      // only on the server path: on the local path they are the same store.
      if (picked.kind === 'server' && !loaded.decks.items.length && !loaded.boards.items.length) {
        const localDecks = loadDecks().length;
        const localBoards = loadBoards().length;
        if (localDecks || localBoards) setImportable({ decks: localDecks, boards: localBoards });
      }
      setReady(true);
    })();
    return () => {
      live = false;
    };
  }, []);

  const write = useCallback(
    <T,>(
      items: T[],
      snapshot: Snapshot<T>,
      setLocal: (s: Snapshot<T>) => void,
      put: (items: T[], version: number) => Promise<Snapshot<T> | { conflict: true; current: Snapshot<T> }>,
    ) => {
      setLocal({ items, version: snapshot.version });
      void put(items, snapshot.version)
        .then((result) => {
          if (isRepoConflict(result)) {
            // Another device wrote first. Take its state rather than overwriting it — the
            // whole point of the version is that this edit was based on stale data.
            setLocal(result.current);
            setError('Your decks changed on another device, so that edit was not saved. Try again.');
            return;
          }
          setLocal(result);
        })
        .catch(() => setError('Could not save. Check your connection and try again.'));
    },
    [],
  );

  const setDecks = useCallback(
    (next: StoredDeck[]) => write(next, decks, setDecksState, (i, v) => repo.putDecks(i, v)),
    [decks, repo, write],
  );

  const setBoards = useCallback(
    (next: StoredBoard[]) => write(next, boards, setBoardsState, (i, v) => repo.putBoards(i, v)),
    [boards, repo, write],
  );

  const importLocal = useCallback(() => {
    const localDecks = loadDecks();
    const localBoards = loadBoards();
    // localStorage is left untouched: it costs nothing to keep and it is the only copy if the
    // import turns out to be wrong.
    if (localDecks.length) setDecks(localDecks);
    if (localBoards.length) setBoards(localBoards);
    setImportable(null);
  }, [setDecks, setBoards]);

  return {
    ready,
    kind: repo.kind,
    decks: decks.items,
    boards: boards.items,
    setDecks,
    setBoards,
    error,
    clearError: () => setError(''),
    importable,
    importLocal,
    dismissImport: () => setImportable(null),
  };
}
