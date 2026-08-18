// Target enumeration: request derivation, per-kind enumeration, content lint,
// and the apply-all invariant (every bound action must apply without throwing).
import { describe, expect, it } from 'vitest';
import { applyAction, debugSpawn, initGame } from '../engine';
import {
  combinedRequest,
  enumerateBoundActions,
  enumerateTargetSets,
  lineRequest,
  targetsNeeded,
} from '../targeting';
import { BRIAR, OSKAR, POC_CARDS } from '../content/poc';
import { DECK_CARDS, DECKS, DECK_TOKENS, makeArenaBoard } from '../content/decks';
import { ALL_SIM_CARDS, COGSWORTH, KAELEN, NERIS, RURIK, THANE, VAEL } from '../content/simDecks';
import { freshGame } from './helpers';
import type { CardDef, GameState, LeaderDef, SpellEffectLine } from '../types';

function spellEffects(def: CardDef | undefined): SpellEffectLine[] {
  if (!def || def.kind === 'unit') throw new Error('expected spell/trap');
  return def.effects;
}

describe('lineRequest / combinedRequest / targetsNeeded', () => {
  it('derives Raise effect-first (declared ChosenUnit target is overridden)', () => {
    const req = combinedRequest(spellEffects(POC_CARDS.raiseTheFallen));
    expect(req).toEqual({ kind: 'raiseTile', type: 'Undead' });
    expect(targetsNeeded(spellEffects(POC_CARDS.raiseTheFallen))).toBe(1);
    expect(combinedRequest(OSKAR.ability.effects).kind).toBe('raiseTile');
  });

  it('derives FuseAdjacentFriendly as a two-coord fusePair', () => {
    expect(combinedRequest(COGSWORTH.ability.effects)).toEqual({ kind: 'fusePair' });
    expect(targetsNeeded(COGSWORTH.ability.effects)).toBe(2);
  });

  it('derives Line3 paint and ChosenUnit ascension', () => {
    expect(combinedRequest(spellEffects(POC_CARDS.verdantSurge))).toEqual({ kind: 'line3' });
    expect(targetsNeeded(spellEffects(POC_CARDS.verdantSurge))).toBe(3);
    // Transform hard-fails on leaders, so the request must exclude them.
    expect(combinedRequest(spellEffects(POC_CARDS.wildAwakening))).toEqual({
      kind: 'unit', enemyOnly: false, friendlyOnly: false, excludeLeaders: true,
    });
  });

  it('Destroy on ChosenEnemy excludes leaders and own units', () => {
    expect(lineRequest({ effect: { e: 'Destroy' }, target: { t: 'ChosenEnemy' } })).toEqual({
      kind: 'unit', enemyOnly: true, friendlyOnly: false, excludeLeaders: true,
    });
  });

  it('trigger-context and auto targets need no chosen coords', () => {
    expect(targetsNeeded(spellEffects(POC_CARDS.scorchMine))).toBe(0); // TriggeringUnit
    expect(targetsNeeded(spellEffects(POC_CARDS.snareVine))).toBe(0);  // trap
  });

  it('rejects incompatible chosen-target mixes across effect lines', () => {
    const mixed: SpellEffectLine[] = [
      { effect: { e: 'PaintTerrain', terrain: 'Forest' }, target: { t: 'Line3' } },
      { effect: { e: 'Damage', amount: 10 }, target: { t: 'ChosenUnit' } },
    ];
    expect(() => combinedRequest(mixed)).toThrow(/incompatible/);
  });
});

describe('content lint — every card/ability has a supported target shape', () => {
  const allDefs: Record<string, CardDef> = { ...POC_CARDS, ...DECK_CARDS, ...ALL_SIM_CARDS };
  const leaders: LeaderDef[] = [
    BRIAR, OSKAR, NERIS, COGSWORTH, VAEL, RURIK, KAELEN, THANE,
    ...DECKS.map((d) => d.leader),
  ];

  it('spells and traps', () => {
    for (const [id, def] of Object.entries(allDefs)) {
      if (def.kind === 'unit') continue;
      expect(() => combinedRequest(def.effects), `card ${id}`).not.toThrow();
    }
  });

  it('leader abilities and unit rules', () => {
    for (const leader of leaders) {
      expect(() => combinedRequest(leader.ability.effects), `ability ${leader.ability.id}`).not.toThrow();
      for (const rule of leader.rules) {
        expect(() => lineRequest(rule), `leader ${leader.id} rule`).not.toThrow();
      }
    }
    for (const [id, def] of Object.entries(allDefs)) {
      if (def.kind !== 'unit') continue;
      for (const rule of def.rules) {
        expect(() => lineRequest(rule), `unit ${id} rule`).not.toThrow();
      }
    }
  });
});

describe('enumerateTargetSets', () => {
  it('unit: filters enemies, leaders, and reach', () => {
    const s = freshGame();
    debugSpawn(s, 'thornfang', 0, { col: 4, row: 2 });
    debugSpawn(s, 'duneshambler', 1, { col: 4, row: 6 });

    const anyUnit = enumerateTargetSets(s, 0, { kind: 'unit', enemyOnly: false, friendlyOnly: false, excludeLeaders: false });
    expect(anyUnit).toHaveLength(4); // 2 leaders + 2 units

    const enemies = enumerateTargetSets(s, 0, { kind: 'unit', enemyOnly: true, friendlyOnly: false, excludeLeaders: true });
    expect(enemies).toEqual([[{ col: 4, row: 6 }]]);

    const nearLeader = enumerateTargetSets(
      s, 0,
      { kind: 'unit', enemyOnly: false, friendlyOnly: false, excludeLeaders: true },
      { resolvePos: { col: 4, row: 1 } },
    );
    expect(nearLeader).toEqual([[{ col: 4, row: 2 }]]);
  });

  it('line3: 120 lines on an empty board; reach collapses to lines inside the 3x3', () => {
    const s = freshGame();
    const all = enumerateTargetSets(s, 0, { kind: 'line3' });
    expect(all).toHaveLength(120);
    const reach = enumerateTargetSets(s, 0, { kind: 'line3' }, { resolvePos: { col: 4, row: 4 } });
    expect(reach).toHaveLength(8); // 3 horizontal + 3 vertical + 2 diagonals within the 3x3
    for (const line of reach) {
      for (const c of line) {
        expect(Math.max(Math.abs(c.col - 4), Math.abs(c.row - 4))).toBeLessThanOrEqual(1);
      }
    }
  });

  it('area: wantsUnits prunes to unit-covering anchors; excludeLeaders drops leader coverage', () => {
    const s = freshGame(); // only the two leaders on board
    const covering = enumerateTargetSets(s, 0, { kind: 'area', size: 3, wantsUnits: true, excludeLeaders: false });
    expect(covering.length).toBeGreaterThan(0);
    for (const [anchor] of covering) {
      // Each anchor's 3x3 footprint must cover one of the leaders at (4,1)/(4,7).
      const coversLeader =
        (Math.abs(anchor!.col - 4) <= 1 && Math.abs(anchor!.row - 1) <= 1) ||
        (Math.abs(anchor!.col - 4) <= 1 && Math.abs(anchor!.row - 7) <= 1);
      expect(coversLeader).toBe(true);
    }
    const noLeaders = enumerateTargetSets(s, 0, { kind: 'area', size: 3, wantsUnits: true, excludeLeaders: true });
    expect(noLeaders).toHaveLength(0);

    const paintAnywhere = enumerateTargetSets(s, 0, { kind: 'area', size: 2, wantsUnits: false, excludeLeaders: false });
    expect(paintAnywhere).toHaveLength(49); // every in-bounds anchor
  });

  it('raiseTile: empty when no matching card in graveyard; leader-ring tiles otherwise', () => {
    const s = freshGame();
    expect(enumerateTargetSets(s, 1, { kind: 'raiseTile', type: 'Undead' })).toHaveLength(0);
    s.players[1].graveyard.push('duneshambler');
    const sets = enumerateTargetSets(s, 1, { kind: 'raiseTile', type: 'Undead' });
    expect(sets).toHaveLength(5); // leader at (4,7): back-row ring has 5 in-bounds empty tiles
    for (const [tile] of sets) {
      expect(Math.max(Math.abs(tile!.col - 4), Math.abs(tile!.row - 7))).toBe(1);
    }
  });

  it('fusePair: only adjacent registered pairs, both orders', () => {
    const s = freshGame(); // P0 fusion pool: apexPredator = thornfang + mosshideBull
    debugSpawn(s, 'thornfang', 0, { col: 3, row: 3 });
    debugSpawn(s, 'mosshideBull', 0, { col: 3, row: 4 });
    debugSpawn(s, 'saplingSentry', 0, { col: 4, row: 3 }); // adjacent but not a registered pair
    const sets = enumerateTargetSets(s, 0, { kind: 'fusePair' });
    expect(sets).toEqual([
      [{ col: 3, row: 3 }, { col: 3, row: 4 }],
      [{ col: 3, row: 4 }, { col: 3, row: 3 }],
    ]);
  });
});

// ---------------------------------------------------------------------------
// Apply-all invariant — the drift alarm. Every action enumerateBoundActions
// emits must apply cleanly; a throw means the enumerator and engine disagree.
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function assertAllApply(start: GameState, seed: number, steps: number, label: string): void {
  const rnd = mulberry32(seed);
  let s = start;
  for (let step = 0; step < steps && s.phase !== 'gameover'; step++) {
    const actions = enumerateBoundActions(s);
    expect(actions.length).toBeGreaterThan(0);
    const results: GameState[] = [];
    for (const a of actions) {
      try {
        results.push(applyAction(s, a));
      } catch (e) {
        throw new Error(
          `${label} seed ${seed} step ${step}: bound action ${JSON.stringify(a)} threw: ${e instanceof Error ? e.message : e}`,
        );
      }
    }
    s = results[Math.floor(rnd() * results.length)]!;
  }
}

describe('enumerateBoundActions — apply-all invariant', () => {
  it('POC decks: every bound action applies cleanly along random playouts', () => {
    for (const seed of [1, 2]) assertAllApply(freshGame(), seed, 25, 'poc');
  });

  it('arena decks: every bound action applies cleanly along a random playout', () => {
    const [a, b] = [DECKS[0]!, DECKS[1]!];
    const s = initGame({
      board: makeArenaBoard(),
      cardDefs: DECK_CARDS,
      tokenDefs: DECK_TOKENS,
      players: [
        { leader: a.leader, deck: [...a.list], fusionPool: [...a.fusionPool] },
        { leader: b.leader, deck: [...b.list], fusionPool: [...b.fusionPool] },
      ],
    });
    assertAllApply(s, 3, 25, `${a.id} vs ${b.id}`);
  });
});
