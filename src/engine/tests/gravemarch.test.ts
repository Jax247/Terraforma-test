// Gravemarch — fourth deck of the 2026-08 overhaul, and the first to be built on the card-choice
// pass (a chosen Raise) and on `Search` mode 'choose'.
//
// These pin the things the DECK EXISTS TO PROVE rather than its stat line: the die -> raise -> die
// loop, two graveyard piles that each pay only their own tribe, and the fact that Insects are
// deliberately UNRAISABLE. If the identity ever erodes back into a pile of Undead, these fail.
//
// ⚠ Every test here was mutation-tested — break the rule it covers and it must FAIL.
import { describe, expect, it } from 'vitest';
import { leaderOf, makeBoard } from '../board';
import { applyAction, debugSpawn, initGame } from '../engine';
import { effectiveAtk } from '../stats';
import { cardCandidates } from '../targeting';
import { deckCost, validateDeck } from '../content/decks';
import { DUNEFORGED_DECK } from '../content/decks/duneforged';
import { GRAVEMARCH_DECK, GRAVEMARCH_EXTRA_CARDS, VESSIK } from '../content/decks/gravemarch';
import { REDMARK_DECK } from '../content/decks/redmark';
import { POC_TOKENS } from '../content/poc';
import { endUntil } from './helpers';
import type { Coord, GameState, UnitCardDef } from '../types';

/** Gravemarch (P0) on neutral ground, so no terrain skews an ATK assertion. */
function game(): GameState {
  return initGame({
    board: makeBoard(() => 'Normal'),
    cardDefs: { ...GRAVEMARCH_DECK.cards, ...REDMARK_DECK.cards },
    tokenDefs: POC_TOKENS,
    players: [
      { leader: VESSIK, deck: [...GRAVEMARCH_DECK.list], fusionPool: [...GRAVEMARCH_DECK.fusionPool] },
      { leader: REDMARK_DECK.leader, deck: [...REDMARK_DECK.list], fusionPool: [...REDMARK_DECK.fusionPool] },
    ],
  });
}

const zoneTile = (s: GameState): Coord => {
  const l = leaderOf(s, 0).pos;
  return { col: l.col + 1, row: l.row };
};
const myBodies = (s: GameState) =>
  Object.values(s.units).filter((u) => u.owner === 0 && !u.isLeader).map((u) => u.cardId);

describe('die → raise → die: the loop the whole deck is built on', () => {
  it('Gather the Dead returns the Undead you NAME, not the one that died last', () => {
    let s = game();
    s.players[0].graveyard = ['bonewrightThrall', 'sepulchreColossus', 'cryptStalker'];
    s.players[0].sp = 8;
    s = applyAction(s, {
      t: 'ActivateAbility', targets: [zoneTile(s)], chosenCards: ['sepulchreColossus'],
    });
    expect(myBodies(s)).toEqual(['sepulchreColossus']); // not cryptStalker, the most recent
    expect(s.players[0].graveyard).toEqual(['bonewrightThrall', 'cryptStalker']);
  });

  it('dying puts a body in the pile, and the pile hands it straight back', () => {
    // The loop end to end, through real combat rather than a doctored state: a body dies, lands in
    // the graveyard, and Gather returns that same card to the board.
    let s = game();
    const thrall = debugSpawn(s, 'bonewrightThrall', 0, { col: 4, row: 4 }); // 20 ATK
    const killer = debugSpawn(s, 'ordathKingsbane', 1, { col: 4, row: 5 }); // 50 ATK, kills it outright
    expect(s.players[0].graveyard).not.toContain('bonewrightThrall');

    s = endUntil(s, 1);
    s = applyAction(s, { t: 'Move', unit: killer.id, to: thrall.pos });
    expect(s.units[thrall.id]).toBeUndefined();
    expect(s.players[0].graveyard).toContain('bonewrightThrall');

    s = endUntil(s, 0);
    s.players[0].sp = 8;
    s = applyAction(s, { t: 'ActivateAbility', targets: [zoneTile(s)], chosenCards: ['bonewrightThrall'] });
    expect(myBodies(s)).toContain('bonewrightThrall');
    expect(s.players[0].graveyard).not.toContain('bonewrightThrall');
  });

  it('⚠ INSECTS ARE UNRAISABLE — the tribe split is enforced by the type filter', () => {
    const s = game();
    s.players[0].graveyard = ['chitinChorister', 'rotmawSwarm', 'charnelHost'];
    s.players[0].sp = 8;
    // Nothing to Gather: the pile is full, and every card in it is fodder.
    expect(cardCandidates(s, 0, { kind: 'graveyard', type: 'Undead' })).toEqual([]);
    expect(() => applyAction(s, {
      t: 'ActivateAbility', targets: [zoneTile(s)], chosenCards: ['chitinChorister'],
    })).toThrow(/not a Undead in your graveyard/);
  });
});

describe('two piles, two payoffs — each scaler reads only its own tribe', () => {
  // Exact values rather than deltas, because TWO auras read these piles and the arithmetic is the
  // point: the body's own +2-per-corpse scaler (its own tribe only) and Vessik's +1-per-Undead
  // team aura (every body, either tribe). Both are printed 30 ATK on Normal ground.
  it('the Undead pile grows Ossuary Warden and the Insect pile does not', () => {
    const s = game();
    const warden = debugSpawn(s, 'ossuaryWarden', 0, { col: 3, row: 3 });
    expect(effectiveAtk(s, s.units[warden.id]!)).toBe(30); // empty pile

    s.players[0].graveyard = ['chitinChorister', 'rotmawSwarm', 'charnelHost']; // three Insects
    expect(effectiveAtk(s, s.units[warden.id]!)).toBe(30); // wrong pile for BOTH auras

    s.players[0].graveyard = ['bonewrightThrall', 'cryptStalker']; // two Undead
    expect(effectiveAtk(s, s.units[warden.id]!)).toBe(36); // 30 + 2x2 own scaler + 1x2 Vessik
  });

  it('the Insect pile grows Charnel Host and the Undead pile does not', () => {
    const s = game();
    const host = debugSpawn(s, 'charnelHost', 0, { col: 3, row: 3 });
    expect(effectiveAtk(s, s.units[host.id]!)).toBe(30);

    s.players[0].graveyard = ['bonewrightThrall', 'cryptStalker']; // two Undead
    expect(effectiveAtk(s, s.units[host.id]!)).toBe(32); // its OWN scaler ignores them; Vessik does not

    s.players[0].graveyard = ['chitinChorister', 'rotmawSwarm', 'charnelHost']; // three Insects
    expect(effectiveAtk(s, s.units[host.id]!)).toBe(36); // 30 + 2x3 own scaler, no Undead for Vessik
  });

  it("only the OWNER's pile counts — the opponent's dead are not your resource", () => {
    const s = game();
    const warden = debugSpawn(s, 'ossuaryWarden', 0, { col: 3, row: 3 });
    const base = effectiveAtk(s, s.units[warden.id]!);
    s.players[1].graveyard = ['bonewrightThrall', 'cryptStalker', 'sepulchreColossus'];
    expect(effectiveAtk(s, s.units[warden.id]!)).toBe(base);
  });
});

describe("Vessik's aura — the buried army makes the standing one hit harder", () => {
  it('scales with the Undead pile and reaches BOTH tribes', () => {
    const s = game();
    const undead = debugSpawn(s, 'bonewrightThrall', 0, { col: 3, row: 3 });
    const insect = debugSpawn(s, 'rotmawSwarm', 0, { col: 6, row: 6 }); // apart: no Frenzy neighbours
    const u0 = effectiveAtk(s, s.units[undead.id]!);
    const i0 = effectiveAtk(s, s.units[insect.id]!);

    s.players[0].graveyard = ['bonewrightThrall', 'cryptStalker', 'sepulchreColossus'];
    expect(effectiveAtk(s, s.units[undead.id]!)).toBe(u0 + 3); // +1 per Undead buried
    expect(effectiveAtk(s, s.units[insect.id]!)).toBe(i0 + 3); // the fodder is carried too
  });
});

describe('Call the Roll — the first Search "choose" in the game', () => {
  it('tutors the named Undead, and draws on top so the bot will actually cast it', () => {
    let s = game();
    s.players[0].hand = ['callTheRoll'];
    s.players[0].deck = [
      ...Array.from({ length: 20 }, () => 'chitinChorister'),
      'thePaleShepherd',
      ...Array.from({ length: 19 }, () => 'rotmawSwarm'),
    ];
    s.players[0].sp = 8;
    const after = applyAction(s, { t: 'CastSpell', card: 'callTheRoll', chosenCards: ['thePaleShepherd'] });
    expect(after.players[0].hand).toContain('thePaleShepherd');
    expect(after.players[0].deck).not.toContain('thePaleShepherd');
    // -1 the spell, +1 the tutored card, +1 the paired draw.
    expect(after.players[0].hand.length).toBe(2);
  });

  it('cannot fetch an Insect — the filter is the tribe split again', () => {
    const s = game();
    s.players[0].hand = ['callTheRoll'];
    s.players[0].deck = Array.from({ length: 40 }, () => 'rotmawSwarm');
    s.players[0].sp = 8;
    expect(() => applyAction(s, { t: 'CastSpell', card: 'callTheRoll', chosenCards: ['rotmawSwarm'] }))
      .toThrow(/not a matching card/);
  });
});

describe('the deck reads as the axis it claims', () => {
  it('every Undead body is a legal Gather target and no Insect is', () => {
    const units = [...new Set(GRAVEMARCH_DECK.list)]
      .map((id) => GRAVEMARCH_DECK.cards[id]!)
      .filter((d): d is UnitCardDef => d.kind === 'unit');
    expect(units.filter((d) => d.type === 'Undead').length).toBeGreaterThanOrEqual(5);
    expect(units.filter((d) => d.type === 'Insect').length).toBeGreaterThanOrEqual(3);
    expect(units.every((d) => d.type === 'Undead' || d.type === 'Insect')).toBe(true);
  });

  it('⚠ fields NO token generator — tokens vanish and would never reach the pile', () => {
    const spawners = [...new Set(GRAVEMARCH_DECK.list)]
      .map((id) => GRAVEMARCH_DECK.cards[id]!)
      .filter((d) => (d.kind === 'unit'
        ? d.rules.some((r) => r.effect.e === 'SummonToken')
        : d.effects.some((l) => l.effect.e === 'SummonToken')));
    expect(spawners.map((d) => d.id)).toEqual([]);
    expect(VESSIK.rules.some((r) => r.effect.e === 'SummonToken')).toBe(false);
  });

  it('the leader takes a NEW id — Duneforged still runs the original Oskar', () => {
    expect(VESSIK.id).not.toBe('oskar');
    expect(DUNEFORGED_DECK.leader.id).toBe('oskar');
  });
});

describe('the frozen shared block — Duneforged imports this registry', () => {
  /**
   * Duneforged defines no cards of its own and is deliberately LAST in the overhaul; it fields all
   * ten of these. Same guard, same reasoning, as `venomSpitter` in hivebrood.ts.
   */
  const FROZEN: Record<string, number> = {
    carrionSwarm: 2, duneshambler: 3, sandRevenant: 3, bonewroughtGolem: 1, plagueBearer: 2,
    marrowHound: 2, raiseTheFallen: 3, corpseTithe: 3, suddenInterment: 2, plagueTitan: 3,
  };

  for (const [id, dc] of Object.entries(FROZEN)) {
    it(`${id} keeps its pre-rebuild definition`, () => {
      const def = GRAVEMARCH_EXTRA_CARDS[id];
      expect(def, `${id} vanished from the shared block`).toBeDefined();
      expect(def!.dc).toBe(dc);
    });
  }

  it('Duneforged is untouched and still legal', () => {
    expect(validateDeck(DUNEFORGED_DECK)).toEqual([]);
    // 95 -> 93 (2026-08-16, the DAMAGE_FLOOR pass): `scorchMine` came down DC 3 -> 2 in poc.ts.
    // 93 -> 95 (same day): `theDebtCalled` was ADDED to the shared block for Duneforged to field.
    // Neither change touches a frozen DEF — the ids above are what this suite guards, and adding a
    // new key to the record is how a Duneforged-only card has to be delivered at all.
    expect(deckCost(DUNEFORGED_DECK)).toBe(95);
  });

  it('and the rebuilt deck shares no card with it', () => {
    const mine = new Set(GRAVEMARCH_DECK.list);
    const theirs = new Set(DUNEFORGED_DECK.list);
    expect([...mine].filter((id) => theirs.has(id))).toEqual([]);
  });
});

describe('The Debt Called — the pile finally weighs something on its own', () => {
  /** Duneforged (P0), with `undead` Undead cards already in its graveyard. */
  function buried(undead: number): GameState {
    const s = initGame({
      board: makeBoard(() => 'Normal'),
      cardDefs: { ...DUNEFORGED_DECK.cards, ...REDMARK_DECK.cards },
      tokenDefs: POC_TOKENS,
      players: [
        { leader: DUNEFORGED_DECK.leader, deck: [...DUNEFORGED_DECK.list], fusionPool: [] },
        { leader: REDMARK_DECK.leader, deck: [...REDMARK_DECK.list], fusionPool: [] },
      ],
    });
    for (let i = 0; i < undead; i++) s.players[0].graveyard.push('duneshambler'); // an Undead body
    s.players[0].hand.push('theDebtCalled');
    s.players[0].sp = 8;
    return s;
  }

  it('the floor always resolves — an empty pile still curses the board for 5', () => {
    // ⚠ THE WHOLE POINT OF THE TWO-LINE SHAPE. The first version gated the entire card on six
    // Undead, which measured 0 games in 72 ever reaching six, so it resolved 0 times in 648 games
    // and a one-ply bot was right to never cast it. A card with a floor is a card that gets played.
    let s = buried(0);
    const foe = debugSpawn(s, 'arrowRunner', 1, { col: 4, row: 4 });
    const before = effectiveAtk(s, foe);
    s = applyAction(s, { t: 'CastSpell', card: 'theDebtCalled' });
    expect(effectiveAtk(s, s.units[foe.id]!)).toBe(before - 5);
  });

  it('at the threshold both lines land and STACK, for -10', () => {
    let s = buried(2);
    const foe = debugSpawn(s, 'arrowRunner', 1, { col: 4, row: 4 });
    const before = effectiveAtk(s, foe);
    s = applyAction(s, { t: 'CastSpell', card: 'theDebtCalled' });
    expect(effectiveAtk(s, s.units[foe.id]!)).toBe(before - 10);
  });

  it('the floor expires at end of turn; the threshold half lingers', () => {
    let s = buried(2);
    const foe = debugSpawn(s, 'arrowRunner', 1, { col: 4, row: 4 });
    const before = effectiveAtk(s, foe);
    s = applyAction(s, { t: 'CastSpell', card: 'theDebtCalled' });
    s = applyAction(s, { t: 'EndTurn' });
    expect(effectiveAtk(s, s.units[foe.id]!)).toBe(before - 5);
  });

  it('hits EVERY enemy at once, and spares your own side entirely', () => {
    // The difference between `AllEnemies` and `AllUnitsOnTerrain`, which deliberately hits both.
    let s = buried(2);
    const a = debugSpawn(s, 'arrowRunner', 1, { col: 4, row: 4 });
    const b = debugSpawn(s, 'arrowRunner', 1, { col: 2, row: 6 });
    const mine = debugSpawn(s, 'duneshambler', 0, { col: 3, row: 3 });
    const beforeA = effectiveAtk(s, a);
    const beforeB = effectiveAtk(s, b);
    const beforeMine = effectiveAtk(s, mine);
    s = applyAction(s, { t: 'CastSpell', card: 'theDebtCalled' });
    expect(effectiveAtk(s, s.units[a.id]!)).toBe(beforeA - 10);
    expect(effectiveAtk(s, s.units[b.id]!)).toBe(beforeB - 10);
    expect(effectiveAtk(s, s.units[mine.id]!)).toBe(beforeMine);
  });

  it('counts only UNDEAD in the pile, not everything in it', () => {
    // The condition names a type, and this deck buries Insects it can never raise alongside the
    // Undead it can. A pile of chaff must not switch the payoff on.
    let s = buried(0);
    for (let i = 0; i < 9; i++) s.players[0].graveyard.push('plagueBearer'); // Insect
    const foe = debugSpawn(s, 'arrowRunner', 1, { col: 4, row: 4 });
    const before = effectiveAtk(s, foe);
    s = applyAction(s, { t: 'CastSpell', card: 'theDebtCalled' });
    expect(effectiveAtk(s, s.units[foe.id]!)).toBe(before - 5); // floor only
  });
});
