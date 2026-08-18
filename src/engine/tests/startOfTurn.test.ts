// StartOfTurn trigger: fires for the ACTIVE player's leader + units only, after
// the full start sequence (status tick → SP refresh → draw → spring relight).
import { describe, expect, it } from 'vitest';
import { applyAction, debugSpawn, spMax } from '../engine';
import { leaderOf } from '../board';
import { freshGame, endUntil, teleport } from './helpers';
import type { CardDef, GameState } from '../types';

const TEST_CARDS: Record<string, CardDef> = {
  sotBurner: {
    kind: 'unit', id: 'sotBurner', name: 'SoT Burner', type: 'Inferno', level: 4, atk: 35, dc: 3,
    keywords: [],
    rules: [{ trigger: 'StartOfTurn', effect: { e: 'Damage', amount: 10 }, target: { t: 'AdjacentEnemies' } }],
  },
  sotSpawner: {
    kind: 'unit', id: 'sotSpawner', name: 'SoT Spawner', type: 'Undead', level: 4, atk: 30, dc: 3,
    keywords: [],
    rules: [{ trigger: 'StartOfTurn', effect: { e: 'SummonToken', tokenId: 'husk', count: 1 }, target: { t: 'EmptyTileNear' } }],
  },
  sotPainter: {
    kind: 'unit', id: 'sotPainter', name: 'SoT Painter', type: 'Verdant', level: 4, atk: 30, dc: 3,
    keywords: [],
    rules: [{ trigger: 'StartOfTurn', effect: { e: 'PaintTerrain', terrain: 'Forest' }, target: { t: 'ThisTile' } }],
  },
  sotBattery: {
    kind: 'unit', id: 'sotBattery', name: 'SoT Battery', type: 'Machine', level: 3, atk: 20, dc: 2,
    keywords: [],
    rules: [{ trigger: 'StartOfTurn', effect: { e: 'GainSP', n: 2 }, target: { t: 'Self' } }],
  },
  weakling: {
    kind: 'unit', id: 'weakling', name: 'Weakling', type: 'Warrior', level: 1, atk: 10, dc: 1,
    keywords: [],
    rules: [{ trigger: 'OnDeath', effect: { e: 'Draw', n: 1 }, target: { t: 'Self' } }],
  },
};

function fresh(): GameState {
  return freshGame({ extraCards: TEST_CARDS });
}

describe('StartOfTurn — firing and dormancy', () => {
  it('fires at the start of the OWNER\'s turn only, and OnDeath chains fire', () => {
    let s = fresh();
    debugSpawn(s, 'sotBurner', 0, { col: 4, row: 4 });
    const victim = debugSpawn(s, 'weakling', 1, { col: 5, row: 4 }); // effATK 10 on Normal
    const p1HandBefore = s.players[1].hand.length;

    // P1's turn starts: P0's burner is dormant.
    s = applyAction(s, { t: 'EndTurn' });
    expect(s.units[victim.id]).toBeDefined();

    // P0's turn starts: burner fires, 10 >= 10 destroys; victim's OnDeath draw fires for P1.
    s = applyAction(s, { t: 'EndTurn' });
    expect(s.units[victim.id]).toBeUndefined();
    expect(s.players[1].graveyard).toContain('weakling');
    expect(s.players[1].hand.length).toBe(p1HandBefore + 2); // +1 turn draw, +1 OnDeath
  });

  it('does not destroy a unit whose effective ATK exceeds the damage', () => {
    let s = fresh();
    debugSpawn(s, 'sotBurner', 0, { col: 4, row: 4 });
    const tough = debugSpawn(s, 'saplingSentry', 1, { col: 5, row: 4 }); // 20 > 10
    s = endUntil(applyAction(s, { t: 'EndTurn' }), 0);
    expect(s.units[tough.id]).toBeDefined();
  });

  it('chips the enemy leader\'s LP and can win the game at turn start', () => {
    let s = fresh();
    const oskar = leaderOf(s, 1);
    const burner = debugSpawn(s, 'sotBurner', 0, { col: 4, row: 4 });
    teleport(s, burner.id, { col: oskar.pos.col, row: oskar.pos.row - 1 });
    s = endUntil(applyAction(s, { t: 'EndTurn' }), 0);
    expect(s.players[1].leaderLife).toBe(190);

    s.players[1].leaderLife = 10;
    s = endUntil(applyAction(s, { t: 'EndTurn' }), 0);
    expect(s.winner).toBe(0);
    expect(s.phase).toBe('gameover');
  });
});

describe('StartOfTurn — effect variety', () => {
  it('summons a token to an adjacent empty tile each turn; fizzles when surrounded', () => {
    let s = fresh();
    const spawner = debugSpawn(s, 'sotSpawner', 0, { col: 4, row: 4 });
    s = endUntil(applyAction(s, { t: 'EndTurn' }), 0);
    const husks = Object.values(s.units).filter((u) => u.isToken && u.owner === 0);
    expect(husks.length).toBe(1);

    // Box the spawner in completely: no empty tile in its surrounding 8 → lenient fizzle.
    const sp = s.units[spawner.id]!;
    const around = [
      [-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1],
    ].map(([dc, dr]) => ({ col: sp.pos.col + dc!, row: sp.pos.row + dr! }));
    for (const c of around) {
      if (!s.board[c.col - 1]![c.row - 1]!.occupant) debugSpawn(s, 'weakling', 0, c);
    }
    const tokensBefore = Object.values(s.units).filter((u) => u.isToken).length;
    s = endUntil(applyAction(s, { t: 'EndTurn' }), 0);
    expect(Object.values(s.units).filter((u) => u.isToken).length).toBe(tokensBefore);
  });

  it('paints its own tile at turn start', () => {
    let s = fresh();
    debugSpawn(s, 'sotPainter', 0, { col: 4, row: 4 });
    expect(s.board[3]![3]!.terrain).toBe('Normal');
    s = endUntil(applyAction(s, { t: 'EndTurn' }), 0);
    expect(s.board[3]![3]!.terrain).toBe('Forest');
  });

  it('GainSP lands AFTER the SP refresh (start effects see fresh resources)', () => {
    let s = fresh();
    debugSpawn(s, 'sotBattery', 0, { col: 4, row: 4 });
    s = endUntil(applyAction(s, { t: 'EndTurn' }), 0);
    expect(s.players[0].sp).toBe(spMax(s.players[0].turnCount) + 2);
  });
});
