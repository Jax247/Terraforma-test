// First real users of previously-unexercised engine paths, via the new deck
// content: GainSP, AdjacentEmptyTiles, unit-level OnCapture/OnMove, GrantMove,
// trap displacement orderings, and autoBind fizzles.
import { afterEach, describe, expect, it } from 'vitest';
import { applyAction, debugSpawn, isSick, spMax } from '../engine';
import { resetRules, setRules } from '../rules';
import { effectiveAtk } from '../stats';
import { leaderOf, mooreAdjacent, tileAt } from '../board';
import { DECK_CARDS, DECK_TOKENS } from '../content/decks';
import { freshGame, teleport } from './helpers';
import type { CardDef, Coord, GameState } from '../types';

afterEach(resetRules);

function fresh(): GameState {
  // DECK_TOKENS, not just POC_TOKENS: the token fixtures moved to Hivebrood's Swarmling when the
  // 2026-08-08 Gravemarch rebuild cut every husk generator.
  return freshGame({ extraCards: DECK_CARDS, extraTokens: DECK_TOKENS });
}

function emptyRingTile(s: GameState, player: 0 | 1): Coord {
  const leader = leaderOf(s, player);
  const tile = mooreAdjacent(leader.pos).find((c) => !tileAt(s.board, c).occupant);
  if (!tile) throw new Error('no empty summon tile');
  return tile;
}

describe('economy — GainSP (first users)', () => {
  it('Corpse Tithe: +2 SP above the refresh cap and +1 card; overflow dies at end of turn', () => {
    let s = fresh();
    s.players[0].hand.push('corpseTithe');
    const sp = s.players[0].sp;
    const hand = s.players[0].hand.length;
    s = applyAction(s, { t: 'CastSpell', card: 'corpseTithe' });
    expect(s.players[0].sp).toBe(sp + 2 - 1); // +2 gained, 1 SP activation cost
    expect(s.players[0].hand.length).toBe(hand); // -1 cast, +1 drawn
    s = applyAction(s, { t: 'EndTurn' });
    expect(s.players[0].sp).toBe(0); // unspent SP (incl. overflow) expires
  });
});

describe('movement — GrantMove (first FriendlyOfTypes users)', () => {
  it('Pack Runner grants every friendly Beast +1 move on summon (itself included)', () => {
    let s = fresh();
    const fang = debugSpawn(s, 'thornfang', 0, { col: 4, row: 4 });
    s.players[0].hand.push('packRunner');
    s = applyAction(s, { t: 'Summon', card: 'packRunner', tile: emptyRingTile(s, 0) });
    expect(s.units[fang.id]!.extraMove).toBe(1);
    const runner = Object.values(s.units).find((u) => u.cardId === 'packRunner')!;
    expect(runner.extraMove).toBe(1);
    // 2-tile move is now legal for the Beast that was already on the board.
    s = applyAction(s, { t: 'Move', unit: fang.id, to: { col: 4, row: 6 } });
    expect(s.units[fang.id]!.pos).toEqual({ col: 4, row: 6 });
  });

  it('Windrider Scout dashes while summoning-sick — but still cannot attack', () => {
    // Sickness is 0 by default since 2026-08-01; this test exists to cover the interaction, so
    // it pins the rule it is about. `afterEach(resetRules)` below keeps that local.
    setRules({ summoningSickTurns: 1 });
    let s = fresh();
    const enemy = debugSpawn(s, 'carrionSwarm', 1, { col: 4, row: 4 });
    s.players[0].hand.push('windriderScout');
    const tile = emptyRingTile(s, 0);
    s = applyAction(s, { t: 'Summon', card: 'windriderScout', tile });
    const scout = Object.values(s.units).find((u) => u.cardId === 'windriderScout')!;
    expect(isSick(scout)).toBe(true);
    expect(scout.extraMove).toBe(1);
    const enemySpot = [
      { col: tile.col - 1, row: tile.row },
      { col: tile.col + 1, row: tile.row },
    ].find((c) => c.col >= 1 && c.col <= 7 && !tileAt(s.board, c).occupant)!;
    teleport(s, enemy.id, enemySpot);
    expect(() => applyAction(s, { t: 'Move', unit: scout.id, to: enemySpot }))
      .toThrow(/summoning-sick/);
    // A sick unit may still MOVE — 2 tiles straight up, thanks to the dash.
    const dest = { col: tile.col, row: tile.row + 2 };
    s = applyAction(s, { t: 'Move', unit: scout.id, to: dest });
    expect(s.units[scout.id]!.pos).toEqual(dest);
  });

  it('Tailwind grants +1 move to all friendly Avian/Inferno units', () => {
    let s = fresh();
    const hawk = debugSpawn(s, 'emberhawk', 0, { col: 3, row: 4 });
    const imp = debugSpawn(s, 'cinderImp', 0, { col: 5, row: 4 });
    const offType = debugSpawn(s, 'thornfang', 0, { col: 4, row: 4 });
    s.players[0].hand.push('tailwind');
    s = applyAction(s, { t: 'CastSpell', card: 'tailwind' });
    expect(s.units[hawk.id]!.extraMove).toBe(1);
    expect(s.units[imp.id]!.extraMove).toBe(1);
    expect(s.units[offType.id]!.extraMove).toBe(0);
  });
});

describe('tokens — AdjacentEmptyTiles (first users)', () => {
  // Repointed off Swarm Mother 2026-08-08: the Gravemarch rebuild cut every husk generator, because
  // tokens never enter the graveyard and that deck's currency is the graveyard. Dune Queen is the
  // same shape, and lives in Hivebrood, which is now the only token deck.
  it('Dune Queen spawns 2 Swarmlings into adjacent empty tiles', () => {
    let s = fresh();
    s.players[0].sp = 10;
    s.players[0].hand.push('duneQueen');
    s = applyAction(s, { t: 'Summon', card: 'duneQueen', tile: emptyRingTile(s, 0) });
    expect(Object.values(s.units).filter((u) => u.isToken && u.owner === 0).length).toBe(2);
  });

  it('overflow: with a single empty adjacent tile, only one Swarmling fits', () => {
    let s = fresh();
    s.players[0].sp = 10;
    s.players[0].hand.push('duneQueen');
    const tile = emptyRingTile(s, 0);
    // Box the summon tile in: fill every empty moore neighbor except one.
    const empties = mooreAdjacent(tile).filter((c) => !tileAt(s.board, c).occupant);
    for (const c of empties.slice(0, -1)) debugSpawn(s, 'carrionSwarm', 1, c);
    s = applyAction(s, { t: 'Summon', card: 'duneQueen', tile });
    expect(Object.values(s.units).filter((u) => u.isToken && u.owner === 0).length).toBe(1);
  });
});

describe('OnDeath chains', () => {
  it('Marrow Hound draws its owner a card when it dies', () => {
    let s = fresh();
    const hound = debugSpawn(s, 'marrowHound', 1, { col: 4, row: 4 });
    const bull = debugSpawn(s, 'mosshideBull', 0, { col: 4, row: 3 });
    const hand = s.players[1].hand.length;
    s = applyAction(s, { t: 'Move', unit: bull.id, to: hound.pos });
    expect(s.units[hound.id]).toBeUndefined();
    expect(s.players[1].hand.length).toBe(hand + 1);
  });

  it('Plague Bearer bursts 10 damage from its death position — enemy leaders chip LP', () => {
    let s = fresh();
    const briar = leaderOf(s, 0);
    const bearerPos = { col: briar.pos.col, row: briar.pos.row + 1 };
    const bearer = debugSpawn(s, 'plagueBearer', 1, bearerPos);
    const bull = debugSpawn(s, 'mosshideBull', 0, { col: bearerPos.col, row: bearerPos.row + 1 });
    s = applyAction(s, { t: 'Move', unit: bull.id, to: bearer.pos });
    expect(s.units[bearer.id]).toBeUndefined();
    expect(s.players[0].leaderLife).toBe(190); // Briar was orthogonally adjacent to the death tile
  });
});

describe('springs — unit-level OnCapture (first user)', () => {
  it('Pearl Diver draws a card when it captures a spring', () => {
    let s = fresh();
    const diver = debugSpawn(s, 'pearlDiver', 0, { col: 2, row: 3 }); // spring at (2,4)
    const hand = s.players[0].hand.length;
    const sp = s.players[0].sp;
    s = applyAction(s, { t: 'Move', unit: diver.id, to: { col: 2, row: 4 } });
    expect(s.players[0].hand.length).toBe(hand + 1);
    expect(s.players[0].sp).toBe(sp + 3);
  });
});

describe('terrain — unit-level OnMove paint + Sea scaling', () => {
  it('Wave Skimmer paints its path Sea', () => {
    let s = fresh();
    const skimmer = debugSpawn(s, 'waveSkimmer', 0, { col: 4, row: 4 });
    s = applyAction(s, { t: 'Move', unit: skimmer.id, to: { col: 4, row: 5 } });
    expect(tileAt(s.board, { col: 4, row: 5 }).terrain).toBe('Sea');
  });

  // ⚠ Repointed TWICE in one day, which is the point: `TerrainTilesAround` scalers are
  // stand-on-your-own-paint, and both decks that had one had it removed as off-axis (Tidecaller's
  // Abyssal Tyrant, then Wildgrowth's Grovecaller). The poc fixture is now the only user, so the
  // engine path is covered here rather than through a registered deck.
  it('the TerrainTilesAround scaler pays +5 per matching tile in the surrounding 8', () => {
    // A local fixture, because no REGISTERED deck carries this scaler any more and the behaviour
    // under test is the engine's, not any deck's.
    const scaler: CardDef = {
      kind: 'unit', id: 'scaler', name: 'Scaler', type: 'Verdant',
      level: 4, atk: 25, def: 15, dc: 2, keywords: [],
      rules: [{
        trigger: 'Passive',
        effect: { e: 'AuraAtkPerCount', amount: 5, count: { c: 'TerrainTilesAround', terrain: 'Forest' } },
        target: { t: 'Self' },
      }],
    };
    const s = freshGame({ extraCards: { ...DECK_CARDS, scaler }, extraTokens: DECK_TOKENS });
    const caller = debugSpawn(s, 'scaler', 0, { col: 4, row: 4 });
    const base = effectiveAtk(s, caller);
    tileAt(s.board, { col: 3, row: 4 }).terrain = 'Forest';
    tileAt(s.board, { col: 5, row: 4 }).terrain = 'Forest';
    expect(effectiveAtk(s, caller)).toBe(base + 10);
  });
});

describe('displacement traps and autoBind', () => {
  it('Undercurrent (respond): fires on an attack into its zone, attack still completes', () => {
    let s = fresh();
    const ring = emptyRingTile(s, 0);
    s.players[0].hand.push('undercurrent');
    s = applyAction(s, { t: 'SetCard', card: 'undercurrent', tile: ring });
    const guard = debugSpawn(s, 'saplingSentry', 0, { col: ring.col, row: ring.row + 1 });
    const bull = debugSpawn(s, 'mosshideBull', 1, { col: ring.col, row: ring.row + 2 });
    s = applyAction(s, { t: 'EndTurn' }); // P1's turn
    s = applyAction(s, { t: 'Move', unit: bull.id, to: guard.pos });
    expect(s.players[0].graveyard).toContain('undercurrent'); // consumed
    expect(s.units[guard.id]).toBeUndefined(); // respond: combat resolved anyway
  });

  it('Repelling Tide (negate): attack canceled AND the attacker is shoved away', () => {
    let s = fresh();
    const ring = emptyRingTile(s, 0);
    s.players[0].hand.push('repellingTide');
    s = applyAction(s, { t: 'SetCard', card: 'repellingTide', tile: ring });
    const guard = debugSpawn(s, 'saplingSentry', 0, { col: ring.col + 1, row: ring.row + 2 });
    const bull = debugSpawn(s, 'mosshideBull', 1, { col: ring.col + 1, row: ring.row + 3 });
    const startPos = { ...bull.pos };
    s = applyAction(s, { t: 'EndTurn' });
    s = applyAction(s, { t: 'Move', unit: bull.id, to: guard.pos });
    expect(s.units[guard.id]).toBeDefined(); // negated: defender lives
    const after = s.units[bull.id]!;
    expect(after.pos).not.toEqual(guard.pos);
    expect(after.pos).not.toEqual(startPos); // pushed away from the trap
    expect(after.hasActed).toBe(true);
  });

  it('Backdraft (respond): attacker takes 20 before combat and dies if that is lethal', () => {
    let s = fresh();
    const ring = emptyRingTile(s, 0);
    s.players[0].hand.push('backdraft');
    s = applyAction(s, { t: 'SetCard', card: 'backdraft', tile: ring });
    const guard = debugSpawn(s, 'saplingSentry', 0, { col: 4, row: 4 });
    const swarm = debugSpawn(s, 'carrionSwarm', 1, { col: 4, row: 5 }); // 15 eff on Desert +10 = 25
    teleport(s, swarm.id, { col: 3, row: 4 }); // Normal tile: eff 15 < 20
    s = applyAction(s, { t: 'EndTurn' });
    s = applyAction(s, { t: 'Move', unit: swarm.id, to: guard.pos });
    expect(s.units[swarm.id]).toBeUndefined();
    expect(s.players[1].graveyard).toContain('carrionSwarm');
    expect(s.units[guard.id]).toBeDefined();
  });

  it('Bramble Maw fizzles cleanly when no enemy is weak enough', () => {
    let s = fresh();
    debugSpawn(s, 'mosshideBull', 1, { col: 4, row: 4 }); // 45 > 20: not a legal target
    s.players[0].sp = 10;
    s.players[0].hand.push('brambleMaw');
    const enemies = Object.values(s.units).filter((u) => u.owner === 1 && !u.isLeader).length;
    s = applyAction(s, { t: 'Summon', card: 'brambleMaw', tile: emptyRingTile(s, 0) });
    expect(Object.values(s.units).filter((u) => u.owner === 1 && !u.isLeader).length).toBe(enemies);
  });

  it('Kraken Avatar drags the auto-picked enemy 2 tiles closer on summon', () => {
    let s = fresh();
    const prey = debugSpawn(s, 'carrionSwarm', 1, { col: 4, row: 5 });
    s.players[0].sp = 10;
    s.players[0].hand.push('krakenAvatar');
    const tile = emptyRingTile(s, 0);
    const before = Math.max(Math.abs(prey.pos.col - tile.col), Math.abs(prey.pos.row - tile.row));
    s = applyAction(s, { t: 'Summon', card: 'krakenAvatar', tile });
    const after = s.units[prey.id]!;
    const dist = Math.max(Math.abs(after.pos.col - tile.col), Math.abs(after.pos.row - tile.row));
    expect(dist).toBeLessThan(before);
  });

  // Repointed off Mistcaller 2026-08-08: the Tidecaller rebuild turned it into an OnTrapTriggered
  // payoff, because a PUSH shoves enemies out of the very trap field the deck is trying to drag
  // them into. Stake-Hand is the same OnSummon-push shape, on the deck that wants it.
  it('Stake-Hand shoves adjacent enemies away — itself and allies unaffected', () => {
    let s = fresh();
    const tile = emptyRingTile(s, 0);
    const enemy = debugSpawn(s, 'carrionSwarm', 1, { col: tile.col, row: tile.row + 1 });
    s.players[0].hand.push('stakeHand');
    s = applyAction(s, { t: 'Summon', card: 'stakeHand', tile });
    const pushed = s.units[enemy.id]!;
    expect(pushed.pos).toEqual({ col: tile.col, row: tile.row + 2 });
  });
});

describe('SP curve sanity', () => {
  it('spMax ladder: 4 / 5 / 6 / 7 / 8 flat — the SHIPPING curve', () => {
    // ⚠ Was 4/7/8 flat until 2026-08-09, when `spStep` went 3 -> 1. The old curve finished on turn
    // 3, so the most expensive body in the game was affordable from turn 3 onward and the economy
    // was a non-factor for 10 of a 13-round game. Adopted for feel: measured balance-neutral
    // (every per-deck delta inside ±5pp) while the first 6+ SP body moves from round 3.4 to 5.3.
    // This asserts what SHIPS — the sim-transcript suites pin the old curve via `withLegacySpCurve`.
    expect([1, 2, 3, 4, 5].map(spMax)).toEqual([4, 5, 6, 7, 8]);
    expect(spMax(9)).toBe(8);
  });
});
