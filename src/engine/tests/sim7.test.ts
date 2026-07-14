// Simulation 7 — Second Full Game (Undead attrition vs Aqua control): every trade
// feeds the graveyard engine, tokens starve it, the fusion clock, and the grind lethal.
import { describe, expect, it } from 'vitest';
import { makeBoard, tileAt, leaderOf } from '../board';
import { effectiveAtk } from '../stats';
import { applyAction, debugSpawn } from '../engine';
import { freshGame, endUntil } from './helpers';
import { NERIS, TIDECALLER_CARDS } from '../content/simDecks';
import { OSKAR } from '../content/poc';
import type { GameState } from '../types';

// P1 = Gravemarch (Oskar), P2 = Tidecaller (Neris).
function grindGame(): GameState {
  return freshGame({
    board: makeBoard(),
    leaders: [OSKAR, NERIS],
    extraCards: TIDECALLER_CARDS,
    fusionPools: [['dreadColossus'], ['leviathan']],
  });
}

describe('Sim 7 — attrition feeds recursion, starves displacement', () => {
  it('every trade feeds Oskar: dead Undead fuel the graveyard-count engine; tokens do not', () => {
    let s = grindGame();
    const revenant = debugSpawn(s, 'sandRevenant', 0, { col: 2, row: 2 });
    const dune = debugSpawn(s, 'duneshambler', 0, { col: 4, row: 4 });
    const naga = debugSpawn(s, 'riptideNaga', 1, { col: 4, row: 5 });
    expect(effectiveAtk(s, revenant)).toBe(35);

    // Neris trades into the shambler: the kill FEEDS the enemy engine.
    s = endUntil(s, 1);
    s = applyAction(s, { t: 'Move', unit: naga.id, to: { col: 4, row: 4 } }); // 35 > 30
    expect(s.units[dune.id]).toBeUndefined();
    expect(s.players[0].graveyard).toContain('duneshambler');
    expect(effectiveAtk(s, s.units[revenant.id]!)).toBe(40); // the count climbed
    // …and its OnDeath left a Husk token behind (the body replaces itself).
    const husk = Object.values(s.units).find((u) => u.isToken)!;
    expect(husk.owner).toBe(0);

    // Oskar answers: the dead Aqua is a real card in Neris's graveyard (public zone) —
    // but her deck has no recursion; for Oskar every body is fuel, for her it's just loss.
    s = endUntil(s, 0);
    const tyrant = debugSpawn(s, 'graveTyrant', 0, { col: 5, row: 4 });
    s = applyAction(s, { t: 'Move', unit: tyrant.id, to: { col: 4, row: 4 } }); // 55 > 35
    expect(s.players[1].graveyard).toContain('riptideNaga');

    // Kill the Husk: tokens VANISH — no graveyard entry, no recursion fuel.
    const huskPos = s.units[husk.id]!.pos;
    const p1GraveSize = s.players[0].graveyard.length;
    const hunter = debugSpawn(s, 'tidePriest', 1, { col: huskPos.col, row: huskPos.row + 1 });
    s = endUntil(s, 1);
    s = applyAction(s, { t: 'Move', unit: hunter.id, to: huskPos });
    expect(s.units[husk.id]).toBeUndefined();
    expect(s.players[0].graveyard.length).toBe(p1GraveSize); // nothing entered
  });
});

describe('Sim 7 — the fusion clock: Leviathan is the only way Aqua closes', () => {
  it('Leviathan connects off Sea footing for the sim-exact 80 (Oskar 200 → 120)', () => {
    let s = grindGame();
    tileAt(s.board, { col: 4, row: 2 }).terrain = 'Sea'; // Neris's painted approach to Oskar at (4,1)
    const levi = debugSpawn(s, 'leviathan', 1, { col: 4, row: 2 });
    s = endUntil(s, 1);
    s = applyAction(s, { t: 'Move', unit: levi.id, to: { col: 4, row: 1 } });
    // 70 + 10 Neris passive (standing on Sea) + 0 battle tile = 80, full to the pool.
    expect(s.players[0].leaderLife).toBe(120);
    expect(s.units[levi.id]).toBeDefined(); // Oskar's 25 strikeback fails
    expect(leaderOf(s, 0).pos).toEqual({ col: 4, row: 1 });
  });

  it('gang-block: the Colossus-killer advances one blocker per turn and never arrives', () => {
    let s = grindGame();
    const levi = debugSpawn(s, 'leviathan', 1, { col: 4, row: 4 });
    const b1 = debugSpawn(s, 'carrionSwarm', 0, { col: 4, row: 3 });
    s = endUntil(s, 1);
    s = applyAction(s, { t: 'Move', unit: levi.id, to: { col: 4, row: 3 } }); // eats blocker #1
    expect(s.units[b1.id]).toBeUndefined();
    expect(s.units[levi.id]!.pos).toEqual({ col: 4, row: 3 });
    // One action per turn: it cannot push further after advancing.
    expect(() => applyAction(s, { t: 'Move', unit: levi.id, to: { col: 4, row: 2 } }))
      .toThrow(/already acted/);
    // Oskar recurs a fresh body into the path (the grind that wins him the matchup).
    s = endUntil(s, 0);
    const b2 = debugSpawn(s, 'duneshambler', 0, { col: 4, row: 2 });
    s = endUntil(s, 1);
    s = applyAction(s, { t: 'Move', unit: levi.id, to: { col: 4, row: 2 } }); // eats blocker #2
    expect(s.units[b2.id]).toBeUndefined();
    expect(s.units[levi.id]!.pos).toEqual({ col: 4, row: 2 }); // still one tile per turn
  });
});

describe('Sim 7 — the grind lethal: cumulative wide-board chip, no burst needed', () => {
  it('two mid bodies close it once Neris is worn down', () => {
    let s = grindGame();
    s.players[1].leaderLife = 60; // T13 state — Neris at (4,7)
    const rev = debugSpawn(s, 'sandRevenant', 0, { col: 4, row: 6 });
    const tyrant = debugSpawn(s, 'graveTyrant', 0, { col: 3, row: 7 });
    s = applyAction(s, { t: 'Move', unit: rev.id, to: { col: 4, row: 7 } });    // 35 chip
    expect(s.players[1].leaderLife).toBe(25);
    expect(s.units[rev.id]).toBeDefined(); // Neris's 25 strikeback < 35: the chipper survives
    s = applyAction(s, { t: 'Move', unit: tyrant.id, to: { col: 4, row: 7 } }); // 55 ends it
    expect(s.players[1].leaderLife).toBeLessThanOrEqual(0);
    expect(s.winner).toBe(0); // Oskar wins by LP depletion, the grind way
  });
});
