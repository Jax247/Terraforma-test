// Seeded RNG + deck shuffling. This module exists because deck order was never randomized
// outside the GUI, which silently made every headless game play its decks in list order.
import { describe, expect, it } from 'vitest';
import { mulberry32, shuffled } from '../rng';
import { ANVIL_DECK } from '../content/decks';

describe('mulberry32', () => {
  it('is deterministic for a seed and differs between seeds', () => {
    const take = (seed: number) => Array.from({ length: 8 }, mulberry32(seed));
    expect(take(42)).toEqual(take(42));
    expect(take(42)).not.toEqual(take(43));
  });

  it('stays inside [0, 1)', () => {
    const r = mulberry32(7);
    for (let i = 0; i < 500; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('shuffled', () => {
  const list = ANVIL_DECK.list;

  it('is a permutation — same 40 cards, same multiset', () => {
    const out = shuffled(list, mulberry32(1));
    expect(out).toHaveLength(list.length);
    expect([...out].sort()).toEqual([...list].sort());
  });

  it('does not mutate its input', () => {
    const before = [...list];
    shuffled(list, mulberry32(2));
    expect(list).toEqual(before);
  });

  it('is deterministic per seed, and different seeds deal different openings', () => {
    expect(shuffled(list, mulberry32(5))).toEqual(shuffled(list, mulberry32(5)));
    expect(shuffled(list, mulberry32(5))).not.toEqual(shuffled(list, mulberry32(6)));
  });

  it('actually reaches the bottom of the list — the bug this fixes', () => {
    // Anvil's support package sits in the last 11 slots. Unshuffled, a game that draws ~25
    // cards never sees any of it, which is why bots measured as "never casting support".
    const tail = new Set(list.slice(-11));
    const opening = shuffled(list, mulberry32(3)).slice(0, 25);
    expect(opening.some((id) => tail.has(id))).toBe(true);
  });
});
