// Phase 4 of the card-vocabulary expansion: Search, permanent counters, GrantKeyword — and the
// seeded RNG the mandatory post-search shuffle forces into GameState.
//
// Lands INERT: no registered card uses any of it, and the default seed never advances while
// nothing consumes randomness, so every existing game is byte-identical.

import { describe, expect, it } from 'vitest';
import { makeBoard } from '../board';
import { COUNTER_STEP, effectiveAtk, effectiveDef } from '../stats';
import { applyAction, debugSpawn, initGame } from '../engine';
import { hasKeyword } from '../status';
import { validateCardRules } from '../content/decks';
import { DEFAULT_SEED, mulberry32, nextRandom, shuffled } from '../rng';
import { OSKAR, POC_CARDS, POC_TOKENS } from '../content/poc';
import { RULES } from '../rules';
import type { CardDef, GameState, SpellEffectLine } from '../types';

const BLANK: CardDef = {
  kind: 'unit', id: 'blank', name: 'Blank', type: 'Beast',
  level: 1, atk: 20, def: 20, dc: 1, keywords: [], rules: [],
};
const DRAGON: CardDef = {
  kind: 'unit', id: 'dragonCard', name: 'Dragon Card', type: 'Dragon',
  level: 6, atk: 50, def: 20, dc: 1, keywords: ['Ranged'], rules: [],
};
const NO_ABILITY = { id: 'noop', name: 'No-op', cost: 99, located: false, effects: [] };

/** A global spell carrying one effect line, so the effect under test is the only variable. */
const spellOf = (id: string, line: SpellEffectLine): CardDef =>
  ({ kind: 'spell', id, name: id, dc: 1, sp: 0, scope: 'global', effects: [line] });

function game(opts: {
  cards?: Record<string, CardDef>;
  deck?: string[];
  seed?: number;
} = {}): GameState {
  const deck = opts.deck ?? Array.from({ length: 40 }, () => 'blank');
  return initGame({
    board: makeBoard(),
    cardDefs: { ...POC_CARDS, blank: BLANK, dragonCard: DRAGON, ...(opts.cards ?? {}) },
    tokenDefs: POC_TOKENS,
    players: [
      { leader: { id: 'l0', name: 'L0', type: 'Warrior', atk: 30, rules: [], ability: NO_ABILITY }, deck, fusionPool: [] },
      { leader: OSKAR, deck: [...deck], fusionPool: [] },
    ],
    seed: opts.seed,
  });
}

// ---------------------------------------------------------------------------
// The RNG
// ---------------------------------------------------------------------------

describe('seeded in-state RNG', () => {
  it('is deterministic for a given seed and advances between calls', () => {
    const a = { rngSeed: 12345 };
    const b = { rngSeed: 12345 };
    const seqA = [nextRandom(a), nextRandom(a), nextRandom(a)];
    const seqB = [nextRandom(b), nextRandom(b), nextRandom(b)];
    expect(seqA).toEqual(seqB);
    expect(new Set(seqA).size).toBe(3); // advanced, not stuck
    expect(a.rngSeed).not.toBe(12345);
  });

  it('different seeds diverge', () => {
    const a = { rngSeed: 1 };
    const b = { rngSeed: 2 };
    expect(nextRandom(a)).not.toBe(nextRandom(b));
  });

  it('defaults, and does not advance while nothing consumes randomness', () => {
    const s = game();
    expect(s.rngSeed).toBe(DEFAULT_SEED);
    const after = applyAction(s, { t: 'EndTurn' });
    expect(after.rngSeed).toBe(DEFAULT_SEED); // a whole turn moved it not at all
  });
});

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

describe('Search', () => {
  const searchFor = (id: string, filter: Record<string, unknown>): CardDef =>
    spellOf(id, { effect: { e: 'Search', filter, mode: 'random' } as never, target: { t: 'Self' } });

  /** A deck with exactly one Dragon buried among Beasts. */
  const mixedDeck = () => [...Array.from({ length: 20 }, () => 'blank'), 'dragonCard', ...Array.from({ length: 19 }, () => 'blank')];

  it('finds only cards matching the filter', () => {
    const s = game({ cards: { findDragon: searchFor('findDragon', { type: 'Dragon' }) }, deck: mixedDeck() });
    s.players[0].hand = ['findDragon']; // clear the opening hand so the fetch is unambiguous
    const after = applyAction(s, { t: 'CastSpell', card: 'findDragon' });
    expect(after.players[0].hand).toContain('dragonCard');
    expect(after.players[0].deck).not.toContain('dragonCard');
  });

  it('filters by keyword and by maxLevel too', () => {
    const s = game({ cards: { byKw: searchFor('byKw', { keyword: 'Ranged' }) }, deck: mixedDeck() });
    s.players[0].hand = ['byKw'];
    expect(applyAction(s, { t: 'CastSpell', card: 'byKw' }).players[0].hand).toContain('dragonCard');

    const s2 = game({ cards: { cheap: searchFor('cheap', { maxLevel: 1 }) }, deck: mixedDeck() });
    s2.players[0].hand = ['cheap'];
    const got = applyAction(s2, { t: 'CastSpell', card: 'cheap' }).players[0].hand;
    expect(got).toContain('blank');      // level 1 qualifies
    expect(got).not.toContain('dragonCard'); // level 6 does not
  });

  it('reshuffles the deck afterwards', () => {
    // The remainder must be HETEROGENEOUS or a shuffle is unobservable: 39 identical cards look
    // the same in any order. So: a strictly blocked deck (all Beasts, then all Dragons), fetch one
    // Beast, and assert the block structure is gone.
    const deck = [
      ...Array.from({ length: 20 }, () => 'blank'),
      ...Array.from({ length: 20 }, () => 'dragonCard'),
    ];
    const s = game({ cards: { findBeast: searchFor('findBeast', { type: 'Beast' }) }, deck, seed: 999 });
    s.players[0].hand = ['findBeast'];
    const before = [...s.players[0].deck];
    const after = applyAction(s, { t: 'CastSpell', card: 'findBeast' });
    const post = after.players[0].deck;

    // Same multiset, one Beast lighter.
    expect([...post].sort()).toEqual(before.filter((_, i) => i !== before.indexOf('blank')).sort());
    // ...and no longer blocked: some Dragon now precedes some Beast.
    const firstDragon = post.indexOf('dragonCard');
    const lastBeast = post.lastIndexOf('blank');
    expect(firstDragon).toBeLessThan(lastBeast);
  });

  it('a whiff fizzles rather than throwing, and still shuffles', () => {
    // No Dragon anywhere in the deck.
    const s = game({ cards: { findDragon: searchFor('findDragon', { type: 'Dragon' }) }, seed: 4242 });
    s.players[0].hand = ['findDragon'];
    const before = [...s.players[0].deck];
    let after!: GameState;
    expect(() => { after = applyAction(s, { t: 'CastSpell', card: 'findDragon' }); }).not.toThrow();
    expect(after.players[0].deck).toHaveLength(before.length); // nothing removed
    expect(after.rngSeed).not.toBe(s.rngSeed);                 // the shuffle still consumed RNG
  });

  it('an unresolvable deck (fog-masked) yields nothing and does not throw', () => {
    // sanitize() replaces opponent deck entries with an id absent from cardDefs' unit pool.
    const s = game({ cards: { findDragon: searchFor('findDragon', { type: 'Dragon' }) } });
    s.players[0].hand = ['findDragon'];
    s.players[0].deck = s.players[0].deck.map(() => '__unknown');
    expect(() => applyAction(s, { t: 'CastSpell', card: 'findDragon' })).not.toThrow();
  });

  it('overflows the hand exactly as a draw does', () => {
    const s = game({ cards: { findDragon: searchFor('findDragon', { type: 'Dragon' }) }, deck: mixedDeck() });
    // Fill to the cap, with the spell as the card we will cast.
    s.players[0].hand = ['findDragon', ...Array.from({ length: RULES.handCap - 1 }, () => 'blank')];
    const after = applyAction(s, { t: 'CastSpell', card: 'findDragon' });
    // Casting removed the spell (cap-1), the fetch put us back at the cap — no burn yet.
    expect(after.pendingBurn).toBeUndefined();

    const s2 = game({ cards: { findDragon: searchFor('findDragon', { type: 'Dragon' }) }, deck: mixedDeck() });
    s2.players[0].hand = ['findDragon', ...Array.from({ length: RULES.handCap, }, () => 'blank')];
    const after2 = applyAction(s2, { t: 'CastSpell', card: 'findDragon' });
    expect(after2.pendingBurn).toBeDefined();
    expect(after2.pendingBurn!.player).toBe(0);
  });

  // Until the 2026-08-08 card-choice pass, `mode: 'choose'` was REJECTED at load — the engine had
  // no Action payload that could name a card. `Action.chosenCards` is that payload, so the two
  // tests below replace the old rejection test with what is now true.
  it("mode 'choose' loads, and a chosen card is what gets fetched", () => {
    const tutor: CardDef = {
      ...BLANK, id: 'tutor',
      rules: [{
        trigger: 'OnSummon',
        effect: { e: 'Search', filter: { type: 'Dragon' }, mode: 'choose' },
        target: { t: 'Self' },
      }],
    };
    expect(validateCardRules(tutor)).toEqual([]);

    const spell = spellOf('tutorSpell', {
      effect: { e: 'Search', filter: { kind: 'unit' }, mode: 'choose' },
      target: { t: 'Self' },
    });
    const s = game({ cards: { tutorSpell: spell }, deck: mixedDeck() });
    s.players[0].hand = ['tutorSpell'];
    const after = applyAction(s, { t: 'CastSpell', card: 'tutorSpell', chosenCards: ['dragonCard'] });
    expect(after.players[0].hand).toContain('dragonCard');
    expect(after.players[0].deck).not.toContain('dragonCard');
  });

  it('naming a card the filter does not match is rejected', () => {
    const spell = spellOf('tutorSpell', {
      effect: { e: 'Search', filter: { type: 'Dragon' }, mode: 'choose' },
      target: { t: 'Self' },
    });
    const s = game({ cards: { tutorSpell: spell }, deck: mixedDeck() });
    s.players[0].hand = ['tutorSpell'];
    expect(() => applyAction(s, { t: 'CastSpell', card: 'tutorSpell', chosenCards: ['blank'] }))
      .toThrow(/not a matching card/);
  });
});

// ---------------------------------------------------------------------------
// Counters
// ---------------------------------------------------------------------------

describe('counters', () => {
  const counterSpell = (id: string, track: 'atk' | 'def', amount: number): CardDef =>
    spellOf(id, { effect: { e: 'AddCounter', track, amount }, target: { t: 'FriendlyOfTypes', types: ['Beast'] } });

  it('the two tracks are independent', () => {
    const s = game({ cards: { grow: counterSpell('grow', 'atk', 2) } });
    const u = debugSpawn(s, 'blank', 0, { col: 4, row: 4 });
    s.board[3]![3]!.terrain = 'Normal';
    s.players[0].hand = ['grow'];
    const after = applyAction(s, { t: 'CastSpell', card: 'grow' });
    expect(effectiveAtk(after, after.units[u.id]!)).toBe(20 + 2 * COUNTER_STEP);
    expect(effectiveDef(after, after.units[u.id]!)).toBe(20); // DEF track untouched
  });

  it('DEF counters raise DEF and leave ATK alone', () => {
    const s = game({ cards: { armour: counterSpell('armour', 'def', 3) } });
    const u = debugSpawn(s, 'blank', 0, { col: 4, row: 4 });
    s.board[3]![3]!.terrain = 'Normal';
    s.players[0].hand = ['armour'];
    const after = applyAction(s, { t: 'CastSpell', card: 'armour' });
    expect(effectiveDef(after, after.units[u.id]!)).toBe(20 + 3 * COUNTER_STEP);
    expect(effectiveAtk(after, after.units[u.id]!)).toBe(20);
  });

  it('a negative amount removes counters', () => {
    const s = game({ cards: { shrink: counterSpell('shrink', 'atk', -1) } });
    const u = debugSpawn(s, 'blank', 0, { col: 4, row: 4 });
    u.atkCounters = 3;
    s.board[3]![3]!.terrain = 'Normal';
    s.players[0].hand = ['shrink'];
    const after = applyAction(s, { t: 'CastSpell', card: 'shrink' });
    expect(after.units[u.id]!.atkCounters).toBe(2);
  });

  it('counters are PERMANENT where an AtkMod status expires', () => {
    const s = game();
    const u = debugSpawn(s, 'blank', 0, { col: 4, row: 4 });
    s.board[3]![3]!.terrain = 'Normal';
    u.atkCounters = 2;
    u.statuses.push({ id: 'x', kind: 'AtkMod', amount: 10, duration: { kind: 'endOfTurn' } });
    expect(effectiveAtk(s, u)).toBe(20 + 10 + 2 * COUNTER_STEP);
    const after = applyAction(s, { t: 'EndTurn' }); // endOfTurn statuses expire here
    expect(effectiveAtk(after, after.units[u.id]!)).toBe(20 + 2 * COUNTER_STEP);
  });
});

// ---------------------------------------------------------------------------
// GrantKeyword
// ---------------------------------------------------------------------------

describe('GrantKeyword', () => {
  const grantSpell = spellOf('grantAnchored', {
    effect: { e: 'GrantKeyword', keyword: 'Anchored', duration: { kind: 'turns', turnsLeft: 2 } },
    target: { t: 'FriendlyOfTypes', types: ['Beast'] },
  });

  it('grants a keyword the card does not print', () => {
    const s = game({ cards: { grantAnchored: grantSpell } });
    const u = debugSpawn(s, 'blank', 0, { col: 4, row: 4 });
    expect(hasKeyword(u, 'Anchored')).toBe(false);
    s.players[0].hand = ['grantAnchored'];
    const after = applyAction(s, { t: 'CastSpell', card: 'grantAnchored' });
    expect(hasKeyword(after.units[u.id]!, 'Anchored')).toBe(true);
  });

  it('a GRANTED keyword survives Suppressed, where a printed one does not', () => {
    // The precedent status.ts already records for WallPass: suppression silences the unit's OWN
    // text, and a grant is another card's text.
    const s = game({
      cards: {
        grantAnchored: grantSpell,
        printed: { ...BLANK, id: 'printed', name: 'printed', keywords: ['Frenzy'] } as CardDef,
      },
    });
    const u = debugSpawn(s, 'printed', 0, { col: 4, row: 4 });
    s.players[0].hand = ['grantAnchored'];
    const after = applyAction(s, { t: 'CastSpell', card: 'grantAnchored' });
    const live = after.units[u.id]!;
    live.statuses.push({ id: 'sup', kind: 'Suppressed', amount: 0, duration: { kind: 'turns', turnsLeft: 2 } });

    expect(hasKeyword(live, 'Frenzy')).toBe(false);   // printed: silenced
    expect(hasKeyword(live, 'Anchored')).toBe(true);  // granted: survives
  });
});

// ---------------------------------------------------------------------------
// Inertness
// ---------------------------------------------------------------------------

describe('phase 4 lands inert', () => {
  it('a fresh game carries zero counters and no granted statuses', () => {
    const s = game();
    for (const u of Object.values(s.units)) {
      expect(u.atkCounters).toBe(0);
      expect(u.defCounters).toBe(0);
      expect(u.statuses.filter((st) => st.kind === 'Granted')).toHaveLength(0);
    }
  });

  it('shuffled() still behaves as rng.test.ts pins it', () => {
    // Guard against having changed the shared generator while adding nextRandom.
    const list = Array.from({ length: 20 }, (_, i) => i);
    expect(shuffled(list, mulberry32(5))).toEqual(shuffled(list, mulberry32(5)));
  });
});
