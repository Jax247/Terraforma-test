// Skyfire — third deck of the 2026-08 overhaul, and the first content built on
// `RULES.favoredTerrainMove`.
//
// These tests are about the things the DECK EXISTS TO PROVE, not its stat line: that the Mountain
// trail bootstraps a body into a permanent 2-mover, that two tiles of reach cash out as a charge
// into an attack, that Terrainfall pays only for ground that actually CHANGED, and that the axis's
// stated cost (no reach at all) is really paid. If the identity ever erodes back into a pile of
// birds, these fail.
//
// ⚠ Every assertion here was mutation-tested: zero the rule it is about (or set
// `favoredTerrainMove` to 0) and the test must FAIL. Several first-draft tests in this repo passed
// either way, and only mutation testing caught it.
import { afterEach, describe, expect, it } from 'vitest';
import { applyAction, debugSpawn, legalActions } from '../engine';
import { makeBoard, tileAt } from '../board';
import { effectiveAtk } from '../stats';
import { resetRules, setRules } from '../rules';
import { deckCost, validateDeck } from '../content/decks';
import { DUNEFORGED_DECK } from '../content/decks/duneforged';
import {
  KAELEN_ASHWING, SKYFIRE_DECK, SKYFIRE_DECK_CARDS, SKYFIRE_EXTRA_CARDS,
} from '../content/decks/skyfire';
import { REDMARK_DECK } from '../content/decks/redmark';
import { endUntil, freshGame, passRounds } from './helpers';
import type { Coord, GameState, UnitCardDef } from '../types';

afterEach(resetRules);

/** Skyfire (P1) on wholly Normal ground, so every tile of Mountain in a test was MADE by the deck. */
function game(): GameState {
  return freshGame({
    board: makeBoard(() => 'Normal'),
    leaders: [KAELEN_ASHWING, REDMARK_DECK.leader],
    extraCards: { ...SKYFIRE_DECK.cards, ...REDMARK_DECK.cards },
    decks: [SKYFIRE_DECK.list, REDMARK_DECK.list],
    fusionPools: [SKYFIRE_DECK.fusionPool, REDMARK_DECK.fusionPool],
  });
}

const terrainAt = (s: GameState, c: Coord) => tileAt(s.board, c).terrain;
const moveDests = (s: GameState, unitId: string): Coord[] =>
  legalActions(s).flatMap((a) => (a.t === 'Move' && a.unit === unitId ? [a.to] : []));
const canReach = (s: GameState, unitId: string, c: Coord): boolean =>
  moveDests(s, unitId).some((d) => d.col === c.col && d.row === c.row);

describe('the Mountain trail — the engine, and why it bootstraps', () => {
  it('a Scoria Hawk paints the tile it LANDS on, not just the ones it crosses', () => {
    // interpolatePath is origin-exclusive and destination-inclusive. That one property is what
    // makes the trail self-sustaining rather than a one-off, so it is asserted directly.
    let s = game();
    const hawk = debugSpawn(s, 'scoriaHawk', 0, { col: 4, row: 3 });
    expect(terrainAt(s, { col: 4, row: 4 })).toBe('Normal');
    s = applyAction(s, { t: 'Move', unit: hawk.id, to: { col: 4, row: 4 } });
    expect(terrainAt(s, { col: 4, row: 4 })).toBe('Mountain');
    expect(terrainAt(s, { col: 4, row: 3 })).toBe('Normal'); // the tile it left is untouched
  });

  it('having painted its own tile, it moves TWO the following turn', () => {
    let s = game();
    const hawk = debugSpawn(s, 'scoriaHawk', 0, { col: 4, row: 3 });
    expect(canReach(s, hawk.id, { col: 4, row: 5 })).toBe(false); // 2 tiles, off its own ground
    s = applyAction(s, { t: 'Move', unit: hawk.id, to: { col: 4, row: 4 } });
    s = passRounds(s, 1); // the hawk has acted; a full round hands the turn back
    expect(terrainAt(s, s.units[hawk.id]!.pos)).toBe('Mountain');
    expect(canReach(s, hawk.id, { col: 4, row: 6 })).toBe(true); // 2 tiles, on its own ridge
  });

  it('and it is the RULE doing it — at favoredTerrainMove 0 the same board only reaches 1', () => {
    // The mutation test, baked in: the trail still paints, but the reach it buys disappears.
    setRules({ favoredTerrainMove: 0 });
    let s = game();
    const hawk = debugSpawn(s, 'scoriaHawk', 0, { col: 4, row: 3 });
    s = applyAction(s, { t: 'Move', unit: hawk.id, to: { col: 4, row: 4 } });
    s = passRounds(s, 1); // the hawk has acted; a full round hands the turn back
    expect(terrainAt(s, s.units[hawk.id]!.pos)).toBe('Mountain');
    expect(canReach(s, hawk.id, { col: 4, row: 6 })).toBe(false);
  });

  it('two tiles of reach cash out as a CHARGE — the far tile may be an enemy', () => {
    let s = game();
    const roc = debugSpawn(s, 'basaltRoc', 0, { col: 4, row: 3 });
    const prey = debugSpawn(s, 'arrowRunner', 1, { col: 4, row: 5 }); // 2 away, 10 ATK
    expect(canReach(s, roc.id, prey.pos)).toBe(false);
    tileAt(s.board, { col: 4, row: 3 }).terrain = 'Mountain'; // stand it on its own ground
    expect(canReach(s, roc.id, prey.pos)).toBe(true);
    const after = applyAction(s, { t: 'Move', unit: roc.id, to: prey.pos });
    expect(after.units[prey.id]).toBeUndefined();
  });

  it('a leader gets the road too — Kaelen is Avian and Mountain is Avian ground', () => {
    const s = game();
    const kaelen = Object.values(s.units).find((u) => u.isLeader && u.owner === 0)!;
    const two = { col: kaelen.pos.col, row: kaelen.pos.row + 2 };
    expect(canReach(s, kaelen.id, two)).toBe(false);
    tileAt(s.board, kaelen.pos).terrain = 'Mountain';
    expect(canReach(s, kaelen.id, two)).toBe(true);
  });
});

describe('Terrainfall — the Crucible Harrier, first user of OnTerrainPainted in the game', () => {
  const atkModsOn = (s: GameState, id: string) =>
    s.units[id]!.statuses.filter((st) => st.kind === 'AtkMod').length;

  it('fires when ground BECOMES Mountain', () => {
    let s = game();
    const harrier = debugSpawn(s, 'crucibleHarrier', 0, { col: 2, row: 2 });
    const hawk = debugSpawn(s, 'scoriaHawk', 0, { col: 4, row: 3 });
    expect(atkModsOn(s, harrier.id)).toBe(0);
    s = applyAction(s, { t: 'Move', unit: hawk.id, to: { col: 4, row: 4 } });
    expect(atkModsOn(s, harrier.id)).toBe(1);
    expect(effectiveAtk(s, s.units[harrier.id]!)).toBe(50); // 40 printed + 10, on Normal ground
  });

  it('does NOT re-fire on a repaint of ground that is already Mountain', () => {
    // The engine only reports tiles whose terrain actually CHANGED. Without that, a trail body
    // walking its own ridge would farm the trigger every turn. The second half is the positive
    // control: the same hawk stepping onto NEW ground does fire it, so this cannot pass just
    // because the rule went missing.
    let s = game();
    const harrier = debugSpawn(s, 'crucibleHarrier', 0, { col: 2, row: 2 });
    const hawk = debugSpawn(s, 'scoriaHawk', 0, { col: 4, row: 3 });
    tileAt(s.board, { col: 4, row: 4 }).terrain = 'Mountain';
    s = applyAction(s, { t: 'Move', unit: hawk.id, to: { col: 4, row: 4 } });
    expect(atkModsOn(s, harrier.id)).toBe(0);

    s = passRounds(s, 1);
    s = applyAction(s, { t: 'Move', unit: hawk.id, to: { col: 4, row: 5 } }); // Normal -> Mountain
    expect(atkModsOn(s, harrier.id)).toBe(1);
  });

  it('ignores an ENEMY raising Mountain — the scope is friendly', () => {
    let s = game();
    const harrier = debugSpawn(s, 'crucibleHarrier', 0, { col: 2, row: 2 });
    const mine = debugSpawn(s, 'scoriaHawk', 0, { col: 6, row: 3 });
    const theirs = debugSpawn(s, 'basaltRoc', 1, { col: 2, row: 6 });
    s = applyAction(s, { t: 'Move', unit: mine.id, to: { col: 6, row: 4 } });
    expect(atkModsOn(s, harrier.id)).toBe(1); // positive control: our own paint does fire it

    s = endUntil(s, 1);
    s = applyAction(s, { t: 'Move', unit: theirs.id, to: { col: 2, row: 5 } });
    expect(terrainAt(s, { col: 2, row: 5 })).toBe('Mountain'); // they really did raise it
    expect(atkModsOn(s, harrier.id)).toBe(0);                  // and we got nothing for it
  });
});

describe('Kaelen punishes the parked — the deck thesis on the leader', () => {
  it('+5 against a defender that did not move on its own turn', () => {
    let s = game();
    const bird = debugSpawn(s, 'ashfallStriker', 0, { col: 4, row: 3 });
    const parked = debugSpawn(s, 'desertersPavise', 1, { col: 4, row: 4 });
    expect(effectiveAtk(s, s.units[bird.id]!)).toBe(40); // no combat context, no bonus

    // Give the defender its own turn and let it sit still: it is now PARKED.
    s = endUntil(s, 1);
    s = endUntil(s, 0);
    const ctx = { role: 'attacker' as const, battleTile: parked.pos, opponentId: parked.id };
    expect(effectiveAtk(s, s.units[bird.id]!, ctx)).toBe(45);
  });

  it('and not against one that moved on its own turn', () => {
    let s = game();
    const bird = debugSpawn(s, 'ashfallStriker', 0, { col: 4, row: 3 });
    const mover = debugSpawn(s, 'arrowRunner', 1, { col: 4, row: 6 });
    s = endUntil(s, 1);
    s = applyAction(s, { t: 'Move', unit: mover.id, to: { col: 4, row: 5 } });
    s = endUntil(s, 0);
    const at = s.units[mover.id]!.pos;
    const ctx = { role: 'attacker' as const, battleTile: at, opponentId: mover.id };
    expect(effectiveAtk(s, s.units[bird.id]!, ctx)).toBe(40);
  });
});

describe('the axis is really paid for', () => {
  it('the deck fields NO reach at all — that is the cost of the movement axis', () => {
    const shooters = [...new Set(SKYFIRE_DECK.list)]
      .map((id) => SKYFIRE_DECK.cards[id]!)
      .filter((d): d is UnitCardDef => d.kind === 'unit')
      .filter((d) => d.keywords.includes('Ranged') || (d.range ?? 1) > 1);
    expect(shooters.map((d) => d.id)).toEqual([]);
    expect(KAELEN_ASHWING.range ?? 1).toBe(1);
  });

  it('every unit is Avian, so one road serves the whole army', () => {
    const offType = [...new Set(SKYFIRE_DECK.list), ...SKYFIRE_DECK.fusionPool]
      .map((id) => SKYFIRE_DECK.cards[id]!)
      .filter((d): d is UnitCardDef => d.kind === 'unit')
      .filter((d) => d.type !== 'Avian');
    expect(offType.map((d) => d.id)).toEqual([]);
    expect(KAELEN_ASHWING.type).toBe('Avian');
  });

  it('enough bodies carry the trail that the road is the deck, not a card', () => {
    const layers = SKYFIRE_DECK.list
      .map((id) => SKYFIRE_DECK.cards[id]!)
      .filter((d): d is UnitCardDef => d.kind === 'unit')
      .filter((d) => d.rules.some((r) => r.trigger === 'OnMove' && r.effect.e === 'PaintTerrain'));
    expect(layers.length).toBeGreaterThanOrEqual(8);
  });
});

describe('the frozen shared block — Duneforged imports this registry', () => {
  /**
   * Duneforged defines no cards of its own and is deliberately LAST in the overhaul. It fields
   * these six as its Desert package, and its whole premise is that Inferno favours Desert — so a
   * pass on Skyfire must not retype them or move their price. Same guard, same reasoning, as
   * `venomSpitter` in hivebrood.ts.
   */
  const FROZEN: Record<string, number> = {
    cinderImp: 2, magmaWhelp: 2, ashenFirebrand: 3, scorchedEarth: 2, stokefire: 2, backdraft: 2,
  };

  for (const [id, dc] of Object.entries(FROZEN)) {
    it(`${id} keeps its Inferno-era definition`, () => {
      const def = SKYFIRE_EXTRA_CARDS[id];
      expect(def, `${id} vanished from the shared block`).toBeDefined();
      expect(def!.dc).toBe(dc);
      if (def!.kind === 'unit') expect(def!.type).toBe('Inferno');
    });
  }

  it('Scorched Earth still paints Desert — Duneforged is the deck that road is for', () => {
    const def = SKYFIRE_EXTRA_CARDS['scorchedEarth']!;
    expect(def.kind).toBe('spell');
    if (def.kind !== 'spell') return;
    expect(def.effects[0]!.effect).toEqual({ e: 'PaintTerrain', terrain: 'Desert' });
  });

  it('Duneforged is untouched and still legal', () => {
    expect(validateDeck(DUNEFORGED_DECK)).toEqual([]);
    // 95 -> 93 (2026-08-16, the DAMAGE_FLOOR pass): `scorchMine` came down DC 3 -> 2 in poc.ts.
    // 93 -> 95 (same day): `theDebtCalled` was ADDED to the shared block for Duneforged to field.
    // Neither change touches a frozen DEF — the ids above are what this suite guards, and adding a
    // new key to the record is how a Duneforged-only card has to be delivered at all.
    expect(deckCost(DUNEFORGED_DECK)).toBe(95);
  });

  it('none of the frozen block leaked into the rebuilt deck except by choice', () => {
    // Only Meteor and the Windrider Scout are deliberately re-fielded; anything else appearing in
    // the list would mean the rework quietly kept an Inferno card it cannot use.
    const kept = [...new Set(SKYFIRE_DECK.list)].filter((id) => !(id in SKYFIRE_DECK_CARDS));
    expect(kept.sort()).toEqual(['meteor', 'windriderScout']);
  });
});
