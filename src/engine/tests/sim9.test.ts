// Simulation 9 — Aggro-Tempo (Skyfire vs Greenwarden): Ranged, Rooted, located-spell
// travel done right, punish-passives, and reach as aggro's out.
import { describe, expect, it } from 'vitest';
import { makeBoard } from '../board';
import { effectiveAtk } from '../stats';
import { applyAction, debugSpawn } from '../engine';
import { freshGame, endUntil, teleport } from './helpers';
import { GREENWARDEN_CARDS, KAELEN, SKYFIRE_CARDS, THANE, TIDECALLER_CARDS } from '../content/simDecks';
import type { GameState } from '../types';

// P1 = Skyfire (Kaelen), P2 = Greenwarden (Thane).
function skyfireGame(): GameState {
  return freshGame({
    board: makeBoard(),
    leaders: [KAELEN, THANE],
    extraCards: { ...SKYFIRE_CARDS, ...GREENWARDEN_CARDS, ...TIDECALLER_CARDS },
  });
}

describe('Sim 9 — Ranged is reach/safety, not power', () => {
  it('attacks without moving: a kill takes no ground (no advance-on-kill exposure)', () => {
    let s = skyfireGame();
    const hawk = debugSpawn(s, 'emberhawk', 0, { col: 4, row: 4 });
    const weak = debugSpawn(s, 'carrionSwarm', 1, { col: 4, row: 5 });
    s = applyAction(s, { t: 'RangedAttack', unit: hawk.id, target: { col: 4, row: 5 } });
    expect(s.units[weak.id]).toBeUndefined();
    expect(s.units[hawk.id]!.pos).toEqual({ col: 4, row: 4 }); // never left its tile
  });

  it('…but still needs the stat edge: 30 loses to a 35 even at range', () => {
    let s = skyfireGame();
    const hawk = debugSpawn(s, 'emberhawk', 0, { col: 4, row: 4 });
    const warden = debugSpawn(s, 'stoneWarden', 1, { col: 4, row: 5 });
    s.units[warden.id]!.movedThisTurn = true; // deny Kaelen's punish +5 for the pure stat check
    s = applyAction(s, { t: 'RangedAttack', unit: hawk.id, target: { col: 4, row: 5 } });
    // TODO(open): whether Ranged sidesteps strikeback is open in the vault; POC ruling
    // keeps binary resolution, so the outclassed ranged attacker still dies.
    expect(s.units[hawk.id]).toBeUndefined();
    expect(s.units[warden.id]).toBeDefined();
    expect(s.units[warden.id]!.pos).toEqual({ col: 4, row: 5 });
  });

  it('Ranged reach is orthogonally adjacent only (POC working ruling)', () => {
    const s = skyfireGame();
    const hawk = debugSpawn(s, 'emberhawk', 0, { col: 4, row: 4 });
    debugSpawn(s, 'stoneWarden', 1, { col: 4, row: 6 });
    expect(() => applyAction(s, { t: 'RangedAttack', unit: hawk.id, target: { col: 4, row: 6 } }))
      .toThrow(/orthogonally adjacent/);
  });
});

describe('Sim 9 — the punish-passive converts development turns into openings', () => {
  it('Kaelen: +5 for Avian/Inferno attacking a unit that has not moved this turn', () => {
    const s = skyfireGame();
    const hawk = debugSpawn(s, 'emberhawk', 0, { col: 4, row: 4 });
    const golem = debugSpawn(s, 'bulwarkGolem', 1, { col: 4, row: 5 });
    const ctx = { role: 'attacker' as const, battleTile: golem.pos, opponentId: golem.id };
    expect(effectiveAtk(s, hawk, ctx)).toBe(35); // 30 + 5: the defender durdled
    golem.movedThisTurn = true;
    expect(effectiveAtk(s, hawk, ctx)).toBe(30); // active boards deny the bonus
    expect(effectiveAtk(s, hawk)).toBe(30);      // never applies outside an attack
  });
});

describe('Sim 9 — Rooted is the structural displacement counter', () => {
  it('a Rooted wall cannot be pushed off a spring', () => {
    let s = skyfireGame();
    teleport(s, 'leader0', { col: 2, row: 3 });
    const golem = debugSpawn(s, 'bulwarkGolem', 1, { col: 2, row: 4 }); // camping the spring tile
    s.players[0].hand.push('undertow');
    s = applyAction(s, { t: 'CastSpell', card: 'undertow', targets: [{ col: 2, row: 4 }] });
    expect(s.units[golem.id]!.pos).toEqual({ col: 2, row: 4 }); // immovable
  });

  it('Rooted units fight and are attacked normally otherwise', () => {
    let s = skyfireGame();
    const roc = debugSpawn(s, 'blazingRoc', 0, { col: 4, row: 4 }); // 40
    const golem = debugSpawn(s, 'bulwarkGolem', 1, { col: 4, row: 5 }); // 30
    s.units[golem.id]!.movedThisTurn = true; // isolate the stat check
    s = applyAction(s, { t: 'Move', unit: roc.id, to: { col: 4, row: 5 } });
    expect(s.units[golem.id]).toBeUndefined(); // Rooted is not toughness
  });
});

describe('Sim 9 — located spell travel, done correctly this time', () => {
  it('Meteor cannot be cast from hand onto a distant cluster', () => {
    const s = skyfireGame();
    s.players[0].hand.push('meteor');
    expect(() => applyAction(s, { t: 'CastSpell', card: 'meteor', targets: [{ col: 5, row: 5 }] }))
      .toThrow(/out of reach.*travel/);
  });

  it('set → travel 2 telegraphed turns → flip: even a board-wipe is a slow physical object', () => {
    let s = skyfireGame();
    const chaff = debugSpawn(s, 'carrionSwarm', 1, { col: 5, row: 5 });  // 15
    const warden = debugSpawn(s, 'stoneWarden', 1, { col: 6, row: 5 });  // 35
    s.players[0].hand.push('meteor');
    s = applyAction(s, { t: 'SetCard', card: 'meteor', tile: { col: 5, row: 2 } });
    const setId = Object.values(s.setCards)[0]!.id;
    s = applyAction(s, { t: 'MoveSet', set: setId, to: { col: 5, row: 3 } });
    s = endUntil(applyAction(s, { t: 'EndTurn' }), 0);
    s = applyAction(s, { t: 'MoveSet', set: setId, to: { col: 5, row: 4 } });
    s = endUntil(applyAction(s, { t: 'EndTurn' }), 0);
    s = applyAction(s, { t: 'FlipCard', set: setId, targets: [{ col: 5, row: 5 }] });
    // Damage 20 to the 2×2: kills the 15, bounces off the 35.
    // TODO(open): Damage-vs-units ruled "destroyed if amount >= effective ATK".
    expect(s.units[chaff.id]).toBeUndefined();
    expect(s.units[warden.id]).toBeDefined();
    expect(s.players[0].graveyard).toContain('meteor');
  });

  it('aggro burn is unit-based and INSTANT by contrast: Pyre Warden torches on summon', () => {
    let s = skyfireGame();
    const softened = debugSpawn(s, 'carrionSwarm', 1, { col: 3, row: 2 });
    s.units[softened.id]!.baseAtk = 10; // already chipped
    s.players[0].hand = ['pyreWarden'];
    s.players[0].sp = 12;
    s = applyAction(s, { t: 'Summon', card: 'pyreWarden', tile: { col: 3, row: 1 } });
    expect(s.units[softened.id]).toBeUndefined(); // 10 damage ≥ effective 10 — no travel, no delay
  });
});

describe('Sim 9 — Divebomb: reach is aggro’s answer to the wall', () => {
  it('+2 move lets a Roc route AROUND a Rooted line', () => {
    let s = skyfireGame();
    const roc = debugSpawn(s, 'blazingRoc', 0, { col: 4, row: 2 });
    // The wall across the middle.
    debugSpawn(s, 'bulwarkGolem', 1, { col: 3, row: 3 });
    debugSpawn(s, 'bulwarkGolem', 1, { col: 4, row: 3 });
    debugSpawn(s, 'bulwarkGolem', 1, { col: 5, row: 3 });
    s.players[0].sp = 12;
    // Without the ability, three steps is out of range.
    expect(() => applyAction(s, { t: 'Move', unit: roc.id, to: { col: 2, row: 3 } }))
      .toThrow(/not reachable/);
    s = applyAction(s, { t: 'ActivateAbility', targets: [{ col: 4, row: 2 }] }); // Divebomb the Roc
    s = applyAction(s, { t: 'Move', unit: roc.id, to: { col: 2, row: 3 } }); // (4,2)→(3,2)→(2,2)→(2,3)
    expect(s.units[roc.id]!.pos).toEqual({ col: 2, row: 3 }); // around the flank
    // The granted movement is this-turn only.
    s = endUntil(applyAction(s, { t: 'EndTurn' }), 0);
    expect(s.units[roc.id]!.extraMove).toBe(0);
  });
});
