// The card-choice pass (2026-08-08) — `Action.chosenCards`, the payload that lets an activation
// name a CARD in a zone rather than a tile on the board.
//
// It unblocks two things that had been parked on it: a `RaiseFromGraveyard` that returns the body
// you want instead of whichever died last (`engine.ts`'s long-standing `TODO(open): card choice`),
// and `Search` mode 'choose', which `validateCardRules` used to REJECT AT LOAD for want of exactly
// this payload.
//
// The load-bearing property is that the pass is ADDITIVE: an action with no `chosenCards` must
// behave precisely as it did before, because every sim suite, every trigger-fired raise, and
// Duneforged's Raise the Fallen were written against the old "most recent match" rule.
//
// ⚠ Every test here was mutation-tested — break the branch it covers and it must FAIL.
import { describe, expect, it } from 'vitest';
import { leaderOf, makeBoard } from '../board';
import { applyAction, initGame } from '../engine';
import { cardCandidates, cardRequest, enumerateBoundActions } from '../targeting';
import { sanitize } from '../../ai';
import { DECKS } from '../content/decks';
import { OSKAR, POC_CARDS, POC_TOKENS } from '../content/poc';
import type { Action, CardDef, GameState, PlayerId } from '../types';

const NO_ABILITY = { id: 'noop', name: 'No-op', cost: 99, located: false, effects: [] };

/** Three distinguishable Undead, so "which one came back" is an observable question. */
const GRUNT: CardDef = { kind: 'unit', id: 'grunt', name: 'Grunt', type: 'Undead', level: 1, atk: 10, def: 5, dc: 1, keywords: [], rules: [] };
const BRUTE: CardDef = { kind: 'unit', id: 'brute', name: 'Brute', type: 'Undead', level: 4, atk: 40, def: 20, dc: 1, keywords: [], rules: [] };
const TITAN: CardDef = { kind: 'unit', id: 'titan', name: 'Titan', type: 'Undead', level: 6, atk: 60, def: 30, dc: 1, keywords: [], rules: [] };
/** Off-type, so the graveyard has something the Undead filter must refuse. */
const BEETLE: CardDef = { kind: 'unit', id: 'beetle', name: 'Beetle', type: 'Insect', level: 2, atk: 20, def: 10, dc: 1, keywords: [], rules: [] };

const RAISE: CardDef = {
  kind: 'spell', id: 'raiseIt', name: 'Raise It', dc: 1, sp: 0, scope: 'global',
  effects: [{ effect: { e: 'RaiseFromGraveyard', type: 'Undead' }, target: { t: 'ChosenUnit' } }],
};
const TUTOR: CardDef = {
  kind: 'spell', id: 'tutorIt', name: 'Tutor It', dc: 1, sp: 0, scope: 'global',
  effects: [{ effect: { e: 'Search', filter: { type: 'Undead' }, mode: 'choose' }, target: { t: 'Self' } }],
};

const CARDS = { ...POC_CARDS, grunt: GRUNT, brute: BRUTE, titan: TITAN, beetle: BEETLE, raiseIt: RAISE, tutorIt: TUTOR };

function game(deck: string[] = Array.from({ length: 40 }, () => 'grunt')): GameState {
  return initGame({
    board: makeBoard(() => 'Normal'),
    cardDefs: CARDS,
    tokenDefs: POC_TOKENS,
    players: [
      { leader: { id: 'l0', name: 'L0', type: 'Undead', atk: 30, rules: [], ability: NO_ABILITY }, deck, fusionPool: [] },
      { leader: OSKAR, deck: [...deck], fusionPool: [] },
    ],
  });
}

/** Put a known graveyard in front of P0 and Raise It in hand. Grave order: grunt, brute, titan. */
function stocked(): GameState {
  const s = game();
  s.players[0].graveyard = ['grunt', 'beetle', 'brute', 'titan'];
  s.players[0].hand = ['raiseIt'];
  return s;
}

const emptyZoneTile = (s: GameState) => {
  const l = leaderOf(s, 0).pos;
  return { col: l.col + 1, row: l.row };
};
const raisedIds = (s: GameState) =>
  Object.values(s.units).filter((u) => u.owner === 0 && !u.isLeader).map((u) => u.cardId);

describe('a chosen Raise returns the body you named', () => {
  it('names a card deeper in the graveyard than the most recent match', () => {
    const s = stocked();
    const after = applyAction(s, {
      t: 'CastSpell', card: 'raiseIt', targets: [emptyZoneTile(s)], chosenCards: ['brute'],
    });
    expect(raisedIds(after)).toEqual(['brute']); // NOT titan, the most recent Undead
    // Brute left the grave; the spell that raised it arrived there.
    expect(after.players[0].graveyard).toEqual(['grunt', 'beetle', 'titan', 'raiseIt']);
  });

  it('and can still name the most recent one', () => {
    const s = stocked();
    const after = applyAction(s, {
      t: 'CastSpell', card: 'raiseIt', targets: [emptyZoneTile(s)], chosenCards: ['titan'],
    });
    expect(raisedIds(after)).toEqual(['titan']);
  });
});

describe('without a choice, nothing changes — the pass is additive', () => {
  it('falls back to the most recent match, exactly as before', () => {
    const s = stocked();
    const after = applyAction(s, { t: 'CastSpell', card: 'raiseIt', targets: [emptyZoneTile(s)] });
    expect(raisedIds(after)).toEqual(['titan']);
    expect(after.players[0].graveyard).toEqual(['grunt', 'beetle', 'brute', 'raiseIt']);
  });

  it('an empty graveyard still reports the old message', () => {
    const s = stocked();
    s.players[0].graveyard = [];
    expect(() => applyAction(s, { t: 'CastSpell', card: 'raiseIt', targets: [emptyZoneTile(s)] }))
      .toThrow(/no Undead in graveyard/);
  });
});

describe('a named card that is not a legal choice is refused', () => {
  it('rejects a card absent from the graveyard', () => {
    const s = stocked();
    expect(() => applyAction(s, {
      t: 'CastSpell', card: 'raiseIt', targets: [emptyZoneTile(s)], chosenCards: ['titanicNonsense'],
    })).toThrow(/not a Undead in your graveyard/);
  });

  it('rejects a card that is in the graveyard but off-type', () => {
    // The Insect is right there and visible — the type filter, not presence, is what refuses it.
    const s = stocked();
    expect(s.players[0].graveyard).toContain('beetle');
    expect(() => applyAction(s, {
      t: 'CastSpell', card: 'raiseIt', targets: [emptyZoneTile(s)], chosenCards: ['beetle'],
    })).toThrow(/not a Undead in your graveyard/);
  });
});

describe('cardRequest / cardCandidates', () => {
  it('reads the request off the effect line, and offers DISTINCT ids only', () => {
    expect(cardRequest(RAISE.kind === 'spell' ? RAISE.effects : [])).toEqual({ kind: 'graveyard', type: 'Undead' });
    const s = stocked();
    s.players[0].graveyard = ['grunt', 'grunt', 'grunt', 'brute'];
    // Three copies of Grunt are ONE choice — this is what keeps the bots' action space flat.
    expect(cardCandidates(s, 0, { kind: 'graveyard', type: 'Undead' })).toEqual(['brute', 'grunt']);
  });

  it('a deck request honours the Search filter', () => {
    const s = game(['grunt', 'beetle', 'titan', ...Array.from({ length: 37 }, () => 'grunt')]);
    expect(cardRequest(TUTOR.kind === 'spell' ? TUTOR.effects : [])).toEqual({ kind: 'deck', filter: { type: 'Undead' } });
    expect(cardCandidates(s, 0, { kind: 'deck', filter: { type: 'Undead' } })).not.toContain('beetle');
  });

  it('is `none` for every other effect — which is why the pass is inert elsewhere', () => {
    // The containment argument, asserted rather than assumed: across every registered deck, the
    // ONLY content asking for a card is Raise the Fallen and Oskar's ability. Anything else
    // gaining a request would silently change that deck's enumeration.
    const asking: string[] = [];
    for (const deck of DECKS) {
      for (const [id, def] of Object.entries(deck.cards)) {
        if (def.kind === 'spell' || def.kind === 'trap') {
          if (cardRequest(def.effects).kind !== 'none') asking.push(id);
        }
      }
      if (cardRequest(deck.leader.ability.effects).kind !== 'none') asking.push(deck.leader.id);
    }
    // `vessik` = Gravemarch's leader ability; `oskar` + `raiseTheFallen` = Duneforged's frozen copies.
    expect([...new Set(asking)].sort()).toEqual(['callTheRoll', 'oskar', 'raiseTheFallen', 'vessik']);
  });
});

describe('enumeration', () => {
  it('emits one bound action per distinct card x tile, and every one applies', () => {
    const s = stocked();
    s.players[0].graveyard = ['grunt', 'brute']; // 2 distinct Undead
    const raises = enumerateBoundActions(s).filter(
      (a): a is Extract<Action, { t: 'CastSpell' }> => a.t === 'CastSpell' && a.card === 'raiseIt',
    );
    const tiles = new Set(raises.map((a) => `${a.targets![0]!.col},${a.targets![0]!.row}`));
    const named = new Set(raises.map((a) => a.chosenCards![0]!));
    expect(named).toEqual(new Set(['grunt', 'brute']));
    expect(raises.length).toBe(tiles.size * 2);
    // The enumerator's contract: nothing it emits may throw.
    for (const a of raises) expect(() => applyAction(s, a)).not.toThrow();
  });

  it('drops the action entirely when the graveyard holds no legal choice', () => {
    const s = stocked();
    s.players[0].graveyard = ['beetle']; // present, but off-type
    expect(enumerateBoundActions(s).some((a) => a.t === 'CastSpell' && a.card === 'raiseIt')).toBe(false);
  });

  it('never enumerates the OPPONENT’s zone', () => {
    const s = stocked();
    s.players[0].graveyard = ['brute'];
    s.players[1].graveyard = ['titan']; // theirs, and richer
    const named = enumerateBoundActions(s)
      .filter((a) => a.t === 'CastSpell' && a.card === 'raiseIt')
      .map((a) => (a as Extract<Action, { t: 'CastSpell' }>).chosenCards![0]);
    expect(new Set(named)).toEqual(new Set(['brute']));
  });
});

describe('fog of war', () => {
  it('own-side candidates are identical under fog — graveyards are public and own zones are not masked', () => {
    const s = stocked();
    s.players[0].graveyard = ['grunt', 'brute', 'titan'];
    for (const me of [0, 1] as PlayerId[]) {
      const fogged = sanitize(s, me);
      expect(cardCandidates(fogged, me, { kind: 'graveyard', type: 'Undead' }))
        .toEqual(cardCandidates(s, me, { kind: 'graveyard', type: 'Undead' }));
    }
  });

  it('a fog-masked OPPONENT deck yields no tutor candidates, and never throws', () => {
    const s = game(['titan', ...Array.from({ length: 39 }, () => 'grunt')]);
    const fogged = sanitize(s, 0); // masks P1's deck
    expect(cardCandidates(fogged, 1, { kind: 'deck', filter: { type: 'Undead' } })).toEqual([]);
    expect(cardCandidates(fogged, 0, { kind: 'deck', filter: { type: 'Undead' } }).length).toBeGreaterThan(0);
  });
});
