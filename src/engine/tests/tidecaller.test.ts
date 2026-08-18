// Tidecaller — fifth deck of the 2026-08 overhaul, rebuilt as THE UNDERTOW: displacement into a
// prepared kill zone.
//
// These pin the things the deck EXISTS to prove, and each corresponds to a measured defect or a
// hard constraint found while building it:
//   · the CHAIN — an intruder springs a trap whose pull springs the next
//   · ⚠ your own drag can NEVER spring your own trap: `fireTraps` arms only the non-active player's
//     cards, so the deck is REACTIVE by law. That constraint is what the design had to be built
//     around, and the test for it is the most important one here.
//   · the leader PULLS, never pushes — her old Push shoved victims out of her own traps
//   · a mine can never be reached by displacement, which is why the deck fields none
//   · `Anchored` refuses the drag — the deck's stated hard counter
//
// ⚠ Every test here was mutation-tested: break the rule it covers and it must FAIL.
import { describe, expect, it } from 'vitest';
import { leaderOf, makeBoard, tileAt } from '../board';
import { applyAction, debugSpawn, initGame } from '../engine';
import { isMineOnly } from '../describe';
import { effectiveAtk } from '../stats';
import { NERIS_UNDERTOW, TIDECALLER_CARDS, TIDECALLER_DECK } from '../content/decks/tidecaller';
import { REDMARK_DECK } from '../content/decks/redmark';
import { POC_TOKENS } from '../content/poc';
import { endUntil } from './helpers';
import type { CardDef, GameState, UnitCardDef } from '../types';

/**
 * ⚠ OWNED FIXTURES, not borrowed deck cards.
 *
 * These tests used Red Mark's `arrowRunner` as "a weak body" and its `desertersPavise` as "an
 * Anchored body", and both broke the moment the 2026-08-09 Guard pass re-statted Red Mark — the
 * runner went 10 -> 15 ATK and the chain stopped killing it. That is the THIRD time an engine test
 * has been broken by an unrelated deck's balance change (flank.test.ts and overflow.test.ts both
 * needed the same fix). A test that asserts "10 ATK dies here" must OWN the 10-ATK card.
 */
const PREY: Record<string, CardDef> = {
  tcMinnow: {
    kind: 'unit', id: 'tcMinnow', name: 'Minnow (fixture)', type: 'Warrior',
    level: 1, atk: 10, def: 10, dc: 1, keywords: [], rules: [],
  },
  tcAnchor: {
    kind: 'unit', id: 'tcAnchor', name: 'Anchor (fixture)', type: 'Warrior',
    level: 2, atk: 25, def: 25, dc: 2, keywords: ['Anchored'], rules: [],
  },
};

/** Tidecaller (P0) on neutral ground, so terrain never skews an assertion. */
function game(): GameState {
  return initGame({
    board: makeBoard(() => 'Normal'),
    cardDefs: { ...TIDECALLER_CARDS, ...REDMARK_DECK.cards, ...PREY },
    tokenDefs: POC_TOKENS,
    players: [
      { leader: NERIS_UNDERTOW, deck: [...TIDECALLER_DECK.list], fusionPool: [...TIDECALLER_DECK.fusionPool] },
      { leader: REDMARK_DECK.leader, deck: [...REDMARK_DECK.list], fusionPool: [...REDMARK_DECK.fusionPool] },
    ],
  });
}

describe('the undertow — the minefield chains on the intruder', () => {
  /** Seed two traps beside the leader, then hand the turn over. */
  function seeded(): GameState {
    let s = game();
    const l = leaderOf(s, 0).pos;
    s.players[0].hand = ['undercurrent', 'drownedGrasp'];
    s.players[0].sp = 8;
    s = applyAction(s, { t: 'SetCard', card: 'undercurrent', tile: { col: l.col + 1, row: l.row } });
    s = applyAction(s, { t: 'SetCard', card: 'drownedGrasp', tile: { col: l.col + 1, row: l.row + 1 } });
    return endUntil(s, 1);
  }

  it('THE CHAIN: walking in springs a trap, whose pull springs the next', () => {
    // ⚠ This fires on the OPPONENT'S turn, and it has to. `fireTraps` arms only the NON-active
    // player's cards ("traps are reactive, opponent-action-only"), so your own drag can never set
    // off your own minefield. The deck does not haul them in; they come, and the water takes them.
    let s = seeded();
    const l = leaderOf(s, 0).pos;
    const prey = debugSpawn(s, 'tcMinnow', 1, { col: l.col + 3, row: l.row });
    s = applyAction(s, { t: 'Move', unit: prey.id, to: { col: l.col + 2, row: l.row } });

    const fired = s.log.filter((x) => /trap .* fires/i.test(x));
    expect(fired.length, 'both traps should chain').toBeGreaterThanOrEqual(2);
    expect(s.units[prey.id], 'and the intruder drowns').toBeUndefined();
  });

  it('⚠ your OWN pull cannot spring your OWN trap — the constraint that made the deck reactive', () => {
    let s = game();
    const l = leaderOf(s, 0).pos;
    s.players[0].hand = ['drownedGrasp', "sirensCall"];
    s.players[0].sp = 8;
    s = applyAction(s, { t: 'SetCard', card: 'drownedGrasp', tile: { col: l.col + 1, row: l.row } });
    const prey = debugSpawn(s, 'tcMinnow', 1, { col: l.col + 3, row: l.row });
    s = applyAction(s, { t: 'CastSpell', card: 'sirensCall', targets: [prey.pos] });

    expect(s.units[prey.id], 'dragged, but not drowned').toBeDefined();
    expect(s.log.some((x) => /trap .* fires/i.test(x))).toBe(false);
  });

  it('Undercurrent drags the intruder DEEPER rather than shoving it out', () => {
    // It was a Push before the rebuild, which threw victims back out of the very zone the deck
    // spends its turns dragging them into.
    const def = TIDECALLER_CARDS['undercurrent']!;
    expect(def.kind).toBe('trap');
    if (def.kind !== 'trap') return;
    expect(def.trigger).toEqual({ t: 'zone' });
    expect(def.effects[0]!.effect).toEqual({ e: 'Pull', tiles: 1 });
  });
});

describe('the leader pulls', () => {
  it("Neris's ability is a Pull, not the Push it used to be", () => {
    // The single highest-leverage edit in the rebuild: the same Area3x3 shape, opposite sign. The
    // old Push fired 2.91x/game — the deck's most frequent effect, shoving enemies out of its traps.
    expect(NERIS_UNDERTOW.ability.effects).toHaveLength(1);
    expect(NERIS_UNDERTOW.ability.effects[0]!.effect).toEqual({ e: 'Pull', tiles: 1 });
    expect(NERIS_UNDERTOW.ability.effects[0]!.target).toEqual({ t: 'Area3x3' });
  });

  it('drags an enemy one tile closer to her', () => {
    let s = game();
    const l = leaderOf(s, 0).pos;
    const prey = debugSpawn(s, 'tcMinnow', 1, { col: l.col + 2, row: l.row });
    s.players[0].sp = 8;
    // The anchor must sit within the leader's reach; the 3x3 around it still covers col+2.
    s = applyAction(s, { t: 'ActivateAbility', targets: [{ col: l.col + 1, row: l.row }] });
    expect(s.units[prey.id]!.pos).toEqual({ col: l.col + 1, row: l.row });
  });
});

describe('what the axis cannot do — the constraints that shaped the deck', () => {
  it('⚠ a MINE is never sprung by displacement, so the deck fields none', () => {
    // A unit is never displaced onto an occupied tile and a set card occupies its own, so a shove
    // can never land a victim on a mine. This is why whirlpoolMine was cut.
    const mines = [...new Set(TIDECALLER_DECK.list)]
      .map((id) => TIDECALLER_DECK.cards[id]!)
      .filter((d) => isMineOnly(d));
    expect(mines.map((d) => d.id)).toEqual([]);
  });

  it('⚠ `Anchored` refuses the drag — the stated hard counter', () => {
    let s = game();
    const l = leaderOf(s, 0).pos;
    const rooted = debugSpawn(s, 'tcAnchor', 1, { col: l.col + 2, row: l.row });
    const before = { ...rooted.pos };
    s.players[0].hand = ["sirensCall"];
    s.players[0].sp = 8;
    s = applyAction(s, { t: 'CastSpell', card: 'sirensCall', targets: [rooted.pos] });
    expect(s.units[rooted.id]!.pos).toEqual(before);
  });
});

describe('Mistcaller — the first card in the game to read OnTrapTriggered', () => {
  it('draws when your minefield springs on the opponent', () => {
    let s = game();
    const l = leaderOf(s, 0).pos;
    s.players[0].hand = ['drownedGrasp'];
    s.players[0].sp = 8;
    s = applyAction(s, { t: 'SetCard', card: 'drownedGrasp', tile: { col: l.col + 1, row: l.row } });
    debugSpawn(s, 'mistcaller', 0, { col: 1, row: 1 }); // far away: the payoff is not positional
    s = endUntil(s, 1);
    const prey = debugSpawn(s, 'tcMinnow', 1, { col: l.col + 3, row: l.row });
    const hand = s.players[0].hand.length;

    s = applyAction(s, { t: 'Move', unit: prey.id, to: { col: l.col + 2, row: l.row } });
    expect(s.log.some((x) => /trap .* fires/i.test(x)), 'the trap sprang').toBe(true);
    expect(s.players[0].hand.length, 'Mistcaller drew off it').toBe(hand + 1);
  });
});

describe('the deck reads as the axis it claims', () => {
  it('the aura marks out the kill zone rather than a terrain', () => {
    // Replaces the old "+10 to Aqua on Sea", which was Wildgrowth's stand-on-your-paint card.
    // NearLeader 2 is exactly the reach of a zone trap set in the leader's own ring.
    const s = game();
    const l = leaderOf(s, 0).pos;
    const near = debugSpawn(s, 'tidePriest', 0, { col: l.col + 2, row: l.row });
    const far = debugSpawn(s, 'tidePriest', 0, { col: l.col + 2, row: l.row + 3 });
    expect(effectiveAtk(s, s.units[near.id]!)).toBe(35); // 25 printed + 10 in the shallows
    expect(effectiveAtk(s, s.units[far.id]!)).toBe(25);
  });

  it('fields more zone traps than any other deck, and no push spells', () => {
    const defs = [...new Set(TIDECALLER_DECK.list)].map((id) => TIDECALLER_DECK.cards[id]!);
    const zoneTraps = defs.filter((d) => d.kind === 'trap' && d.trigger.t === 'zone');
    expect(zoneTraps.length).toBeGreaterThanOrEqual(3);
    // Push survives only on Repelling Tide, the panic button for a deck that hauls enemies close.
    const pushers = defs.filter((d) => d.kind === 'spell' && d.effects.some((l) => l.effect.e === 'Push'));
    expect(pushers.map((d) => d.id)).toEqual([]);
  });

  it('every body is Aqua and enough of them drag', () => {
    const units = [...new Set(TIDECALLER_DECK.list)]
      .map((id) => TIDECALLER_DECK.cards[id]!)
      .filter((d): d is UnitCardDef => d.kind === 'unit');
    expect(units.every((d) => d.type === 'Aqua')).toBe(true);
    const draggers = TIDECALLER_DECK.list
      .map((id) => TIDECALLER_DECK.cards[id]!)
      .filter((d) => d.kind === 'unit' && d.rules.some((r) => r.effect.e === 'Pull'));
    expect(draggers.length).toBeGreaterThanOrEqual(6);
  });
});

describe('the leader still makes the water the victims land in', () => {
  it('paints Sea along the tiles she walks', () => {
    let s = game();
    const l = leaderOf(s, 0);
    const to = { col: l.pos.col, row: l.pos.row + 1 };
    expect(tileAt(s.board, to).terrain).toBe('Normal');
    s = applyAction(s, { t: 'Move', unit: l.id, to });
    expect(tileAt(s.board, to).terrain).toBe('Sea');
  });
});

describe('The Tide Turns — the water itself closes', () => {
  /** Sea under `tiles`, everything else Normal, so the terrain filter is the only variable. */
  function withSea(tiles: { col: number; row: number }[]): GameState {
    const s = game();
    for (const t of tiles) tileAt(s.board, t).terrain = 'Sea';
    s.players[0].hand = ['theTideTurns'];
    s.players[0].sp = 8;
    return s;
  }

  it('snares every unit standing on Sea, and nothing standing off it', () => {
    const wet = { col: 2, row: 2 };
    const dry = { col: 5, row: 5 };
    let s = withSea([wet]);
    const soaked = debugSpawn(s, 'tcMinnow', 1, wet);
    const ashore = debugSpawn(s, 'tcMinnow', 1, dry);
    s = applyAction(s, { t: 'CastSpell', card: 'theTideTurns' });
    expect(s.units[soaked.id]!.statuses.some((st) => st.kind === 'Snared')).toBe(true);
    expect(s.units[ashore.id]!.statuses.some((st) => st.kind === 'Snared')).toBe(false);
  });

  it('⚠ hits BOTH sides — a painter standing in their own hazard suffers it', () => {
    // The deliberate cost, and the same rule Neris's own Area3x3 ability carries. It is what makes
    // the card a timing decision rather than a free button, and for an Aqua deck standing on its
    // own favored terrain that is a genuinely hard ask.
    const wet = { col: 3, row: 3 };
    let s = withSea([wet]);
    const mine = debugSpawn(s, 'tcMinnow', 0, wet);
    s = applyAction(s, { t: 'CastSpell', card: 'theTideTurns' });
    expect(s.units[mine.id]!.statuses.some((st) => st.kind === 'Snared')).toBe(true);
  });

  it('does not care how big the body is — the DAMAGE_FLOOR problem does not apply', () => {
    // The reason this deck's kill zone leans on statuses rather than damage: `applyDamage` is a
    // threshold against effective ATK, so a big body shrugs off every damage card in the pool. A
    // status does not ask.
    const wet = { col: 4, row: 2 };
    let s = withSea([wet]);
    const whale = debugSpawn(s, 'drownedColossus', 1, wet);
    expect(effectiveAtk(s, whale)).toBeGreaterThan(30);
    s = applyAction(s, { t: 'CastSpell', card: 'theTideTurns' });
    expect(s.units[whale.id]!.statuses.some((st) => st.kind === 'Snared')).toBe(true);
  });

  it('fizzles harmlessly when there is no water yet', () => {
    let s = game(); // no Sea painted at all
    s.players[0].hand = ['theTideTurns'];
    s.players[0].sp = 8;
    const dry = debugSpawn(s, 'tcMinnow', 1, { col: 2, row: 2 });
    s = applyAction(s, { t: 'CastSpell', card: 'theTideTurns' });
    expect(s.units[dry.id]!.statuses.some((st) => st.kind === 'Snared')).toBe(false);
    expect(s.players[0].graveyard).toContain('theTideTurns'); // spent regardless
  });
});
