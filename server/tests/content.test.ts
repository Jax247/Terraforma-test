import { describe, expect, it } from 'vitest';
import { isConflict, MemoryContentStore } from '../content.ts';

const deck = (id: string) => ({ id, name: `Deck ${id}`, list: [] });

describe('content store', () => {
  it('starts empty at version 0', async () => {
    const store = new MemoryContentStore();
    expect(await store.get('u1')).toEqual({ decks: { items: [], version: 0 }, boards: { items: [], version: 0 } });
  });

  it('writes a collection and bumps its version', async () => {
    const store = new MemoryContentStore();
    const r = await store.put('u1', 'decks', [deck('a')], 0);
    expect(isConflict(r)).toBe(false);
    if (isConflict(r)) return;
    expect(r.version).toBe(1);
    expect((await store.get('u1')).decks.items).toEqual([deck('a')]);
  });

  it('keeps collections independent', async () => {
    const store = new MemoryContentStore();
    await store.put('u1', 'decks', [deck('a')], 0);
    const got = await store.get('u1');
    // Writing decks must not bump boards, or the other device's next board save is refused
    // for no reason.
    expect(got.boards.version).toBe(0);
    expect(got.decks.version).toBe(1);
  });

  it('keeps accounts separate', async () => {
    const store = new MemoryContentStore();
    await store.put('u1', 'decks', [deck('a')], 0);
    expect((await store.get('u2')).decks.items).toEqual([]);
  });

  it('refuses a stale write instead of destroying the newer one', async () => {
    const store = new MemoryContentStore();
    // Device A and device B both read version 0.
    await store.put('u1', 'decks', [deck('a'), deck('b')], 0); // A saves, now version 1
    const stale = await store.put('u1', 'decks', [deck('a')], 0); // B saves from version 0

    expect(isConflict(stale)).toBe(true);
    if (!isConflict(stale)) return;
    // B's write is refused AND B is handed the truth, so deck b is not lost.
    expect(stale.current.version).toBe(1);
    expect(stale.current.items).toEqual([deck('a'), deck('b')]);
    expect((await store.get('u1')).decks.items).toEqual([deck('a'), deck('b')]);
  });

  it('accepts the retry once the caller rebases on the current version', async () => {
    const store = new MemoryContentStore();
    await store.put('u1', 'decks', [deck('a')], 0);
    const ok = await store.put('u1', 'decks', [deck('a'), deck('c')], 1);
    expect(isConflict(ok)).toBe(false);
    if (isConflict(ok)) return;
    expect(ok.version).toBe(2);
  });

  it('does not alias what the caller passed in', async () => {
    const store = new MemoryContentStore();
    const items = [deck('a')];
    await store.put('u1', 'decks', items, 0);
    items.push(deck('mutated-after-save'));
    // A store that aliased would "persist" edits made after the write returned.
    expect((await store.get('u1')).decks.items).toHaveLength(1);
  });
});
