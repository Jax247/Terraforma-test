// Wall terrain: impassable tiles. Nothing enters, passes through, or deploys onto a Wall
// unless the unit can pass walls (the `Wallwalk` keyword, or a `GrantWallPass` status granted
// by another card). Conventional terrain painting cannot overwrite one either — that immunity
// is the part exposed as an experiment toggle (`RULES.wallsPaintable`).

import { afterEach, describe, expect, it } from 'vitest';
import { applyAction, debugSpawn, legalActions } from '../engine';
import { canPassWalls, isOpen, isWall, makeBoard, sameCoord, tileAt } from '../board';
import { resetRules, setRules } from '../rules';
import { terrainMod } from '../stats';
import { freshGame } from './helpers';
import type { CardDef, Coord, GameState } from '../types';

afterEach(resetRules);

/** All-Normal board so terrain arithmetic never muddies a movement assertion. */
const flat = (extraCards?: Record<string, CardDef>) =>
  freshGame({ board: makeBoard(() => 'Normal'), extraCards });

const wall = (s: GameState, c: Coord) => {
  tileAt(s.board, c).terrain = 'Wall';
};

const canReach = (s: GameState, unitId: string, to: Coord) =>
  legalActions(s).some((a) => a.t === 'Move' && a.unit === unitId && sameCoord(a.to, to));

/** A Wallwalk copy of Thornfang, plus a spell that grants the same passage to a chosen unit. */
const WALL_CARDS: Record<string, CardDef> = {
  wallStrider: {
    kind: 'unit', id: 'wallStrider', name: 'Wall Strider', type: 'Beast', level: 3, atk: 30, dc: 3,
    keywords: ['Wallwalk'], rules: [],
  },
  breach: {
    kind: 'spell', id: 'breach', name: 'Breach', dc: 2, scope: 'global',
    effects: [{ effect: { e: 'GrantWallPass', duration: { kind: 'turns', turnsLeft: 2 } }, target: { t: 'ChosenUnit' } }],
  },
};

describe('walls block movement', () => {
  it('a unit cannot move onto a Wall', () => {
    const s = flat();
    const u = debugSpawn(s, 'thornfang', 0, { col: 4, row: 4 });
    const target = { col: 4, row: 5 };
    expect(canReach(s, u.id, target)).toBe(true);
    wall(s, target);
    expect(canReach(s, u.id, target)).toBe(false);
    expect(() => applyAction(s, { t: 'Move', unit: u.id, to: target })).toThrow(/not reachable/);
  });

  it('a unit cannot path THROUGH a Wall even with movement to spare', () => {
    const s = flat();
    const u = debugSpawn(s, 'thornfang', 0, { col: 4, row: 4 });
    u.extraMove = 1; // two tiles of movement
    const beyond = { col: 4, row: 6 };
    expect(canReach(s, u.id, beyond)).toBe(true);
    wall(s, { col: 4, row: 5 }); // the only straight route
    expect(canReach(s, u.id, beyond)).toBe(false);
    // …but a way around still works: the detour is 2 tiles too.
    expect(canReach(s, u.id, { col: 5, row: 5 })).toBe(true);
  });

  // A global spell resolves from the caster's leader (P1 at row 1), so this pushes "north".
  const shove: Record<string, CardDef> = {
    shove: {
      kind: 'spell', id: 'shove', name: 'Shove', dc: 2, scope: 'global',
      effects: [{ effect: { e: 'Push', tiles: 3 }, target: { t: 'ChosenUnit' } }],
    },
  };

  it('a push stops at the tile before a Wall instead of crossing it', () => {
    // Thornfang, not Sapling Sentry — Anchored units ignore displacement entirely.
    const open = flat(shove);
    const far = debugSpawn(open, 'thornfang', 1, { col: 4, row: 3 });
    open.players[0].hand.push('shove');
    const unblocked = applyAction(open, { t: 'CastSpell', card: 'shove', targets: [far.pos] });
    expect(unblocked.units[far.id]!.pos).toEqual({ col: 4, row: 6 }); // 3 tiles, halted by P2's leader

    const s = flat(shove);
    const victim = debugSpawn(s, 'thornfang', 1, { col: 4, row: 3 });
    wall(s, { col: 4, row: 5 });
    s.players[0].hand.push('shove');
    const end = applyAction(s, { t: 'CastSpell', card: 'shove', targets: [victim.pos] });
    expect(end.units[victim.id]!.pos).toEqual({ col: 4, row: 4 }); // halted before the wall
  });
});

describe('walls block deployment', () => {
  it('summon and set both refuse a Wall tile', () => {
    const s = flat();
    const leaderRing = { col: 4, row: 2 };
    wall(s, leaderRing);
    const card = s.players[0].hand.find((id) => s.cardDefs[id]?.kind === 'unit')!;
    expect(() => applyAction(s, { t: 'Summon', card, tile: leaderRing })).toThrow(/passable/);
    expect(() => applyAction(s, { t: 'SetCard', card, tile: leaderRing })).toThrow(/passable/);
  });

  it('the leader summon ring drops walled tiles from the legal-action list', () => {
    const s = flat();
    const ring = { col: 4, row: 2 };
    const before = legalActions(s).filter((a) => a.t === 'Summon' && sameCoord(a.tile, ring));
    expect(before.length).toBeGreaterThan(0);
    wall(s, ring);
    expect(legalActions(s).filter((a) => a.t === 'Summon' && sameCoord(a.tile, ring))).toEqual([]);
  });

  it('isOpen rejects a Wall even when nothing occupies it', () => {
    const s = flat();
    const c = { col: 3, row: 3 };
    expect(isOpen(s, c)).toBe(true);
    wall(s, c);
    expect(isWall(s, c)).toBe(true);
    expect(isOpen(s, c)).toBe(false);
  });
});

describe('effects that grant passage', () => {
  it('the Wallwalk keyword lets a unit enter and cross a Wall', () => {
    const s = flat(WALL_CARDS);
    const u = debugSpawn(s, 'wallStrider', 0, { col: 4, row: 4 });
    const target = { col: 4, row: 5 };
    wall(s, target);
    expect(canPassWalls(u)).toBe(true);
    expect(canReach(s, u.id, target)).toBe(true);
    const end = applyAction(s, { t: 'Move', unit: u.id, to: target });
    expect(end.units[u.id]!.pos).toEqual(target);
  });

  it('another card’s effect can grant passage to a plain unit', () => {
    const s = flat(WALL_CARDS);
    const u = debugSpawn(s, 'thornfang', 0, { col: 4, row: 4 });
    const target = { col: 4, row: 5 };
    wall(s, target);
    expect(canReach(s, u.id, target)).toBe(false);

    s.players[0].hand.push('breach');
    const granted = applyAction(s, { t: 'CastSpell', card: 'breach', targets: [u.pos] });
    expect(canPassWalls(granted.units[u.id]!)).toBe(true);
    expect(canReach(granted, u.id, target)).toBe(true);
  });

  it('passage is not granted to everyone else', () => {
    const s = flat(WALL_CARDS);
    const walker = debugSpawn(s, 'wallStrider', 0, { col: 2, row: 4 });
    const plain = debugSpawn(s, 'thornfang', 0, { col: 6, row: 4 });
    wall(s, { col: 3, row: 4 });
    wall(s, { col: 5, row: 4 });
    expect(canReach(s, walker.id, { col: 3, row: 4 })).toBe(true);
    expect(canReach(s, plain.id, { col: 5, row: 4 })).toBe(false);
  });
});

describe('walls and terrain painting', () => {
  const paintCard: Record<string, CardDef> = {
    repaint: {
      kind: 'spell', id: 'repaint', name: 'Repaint', dc: 2, scope: 'global',
      effects: [{ effect: { e: 'PaintTerrain', terrain: 'Forest' }, target: { t: 'Area3x3' } }],
    },
  };

  function paintOver(walled: Coord): GameState {
    const s = flat(paintCard);
    wall(s, walled);
    s.players[0].hand.push('repaint');
    return applyAction(s, { t: 'CastSpell', card: 'repaint', targets: [walled] });
  }

  it('conventional painting leaves a Wall standing (and says so in the log)', () => {
    const walled = { col: 4, row: 4 };
    const end = paintOver(walled);
    expect(tileAt(end.board, walled).terrain).toBe('Wall');
    expect(tileAt(end.board, { col: 4, row: 5 }).terrain).toBe('Forest'); // neighbours still painted
    expect(end.log.some((l) => l.includes('Wall tile(s) unaffected'))).toBe(true);
  });

  it('the wallsPaintable experiment lets painting level a Wall', () => {
    setRules({ wallsPaintable: true });
    const walled = { col: 4, row: 4 };
    expect(tileAt(paintOver(walled).board, walled).terrain).toBe('Forest');
  });
});

describe('wall tiles are stat-neutral', () => {
  it('no type is favored or weak on a Wall', () => {
    expect(terrainMod('Terra', 'Wall')).toBe(0);
    expect(terrainMod('Aqua', 'Wall')).toBe(0);
    expect(terrainMod('Dragon', 'Wall')).toBe(0);
  });
});
