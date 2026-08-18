// Simulation 5 — Leaders Leaning on Actives: SP costs compete with deployment,
// located-reach demands leader exposure, Raise converts card-hunger into SP tradeoff.
import { describe, expect, it } from 'vitest';
import { makeBoard, tileAt } from '../board';
import { applyAction, debugSpawn, isSick } from '../engine';
import { freshGame, endUntil, teleport, withSummoningSickness } from './helpers';

// These narratives were transcribed from the vault sims, which were played under the 1-turn
// summoning-sickness rule. The tester's default became 0 on 2026-08-01; pin the rule the sim
// was written for so the transcript keeps testing what it recorded.
withSummoningSickness();

describe('Sim 5 — the SP-cost model does double duty', () => {
  it("Overgrowth (5) + a Lv-5 summon = 10/10: the ability EATS the second summon", () => {
    let s = freshGame({ board: makeBoard() });
    s.players[0].sp = 10; // turn-3 budget
    s.players[0].hand = ['mosshideBull', 'mosshideBull'];
    // Briar starts at (4,1) — this line sits entirely within her own reach.
    s = applyAction(s, {
      t: 'ActivateAbility',
      targets: [{ col: 3, row: 2 }, { col: 4, row: 2 }, { col: 5, row: 2 }],
    });
    expect(s.players[0].sp).toBe(5);
    expect(tileAt(s.board, { col: 4, row: 2 }).terrain).toBe('Forest');
    s = applyAction(s, { t: 'Summon', card: 'mosshideBull', tile: { col: 3, row: 1 } });
    expect(s.players[0].sp).toBe(0);
    // No second bull this turn — the active visibly competed with deployment.
    expect(() => applyAction(s, { t: 'Summon', card: 'mosshideBull', tile: { col: 5, row: 1 } }))
      .toThrow(/not enough SP/);
  });

  it('leader actives are the SP sink for cap turns: Raise 5 + Grave Tyrant 6 = 11/12', () => {
    let s = freshGame();
    s = endUntil(s, 1);
    s.players[1].sp = 12;
    s.players[1].graveyard.push('duneshambler');
    s.players[1].hand = ['graveTyrant'];
    s = applyAction(s, { t: 'ActivateAbility', targets: [{ col: 4, row: 6 }] });
    expect(s.players[1].sp).toBe(7);
    s = applyAction(s, { t: 'Summon', card: 'graveTyrant', tile: { col: 3, row: 7 } });
    expect(s.players[1].sp).toBe(1); // 11 of 12 productively consumed
  });
});

describe('Sim 5 — the located-reach rule creates skill expression', () => {
  it('Oskar (risky use): Raise returns the body to OSKAR’s reach — he must march forward', () => {
    let s = freshGame();
    s = endUntil(s, 1);
    s.players[1].sp = 12;
    s.players[1].graveyard.push('duneshambler');
    // From the back rank, the contested mid-board tile is simply not raisable.
    expect(() => applyAction(s, { t: 'ActivateAbility', targets: [{ col: 4, row: 4 }] }))
      .toThrow(/reach/);
    // March Oskar forward (exposing a 25-ATK leader) and the same Raise works.
    teleport(s, 'leader1', { col: 4, row: 5 });
    s = applyAction(s, { t: 'ActivateAbility', targets: [{ col: 4, row: 4 }] });
    const raised = Object.values(s.units).find((u) => u.cardId === 'duneshambler' && u.owner === 1);
    expect(raised).toBeDefined();
    expect(raised!.pos).toEqual({ col: 4, row: 4 });
    expect(isSick(raised!)).toBe(true); // recursion is tempo, not a burst
    expect(s.players[1].graveyard).not.toContain('duneshambler');
  });

  it('Briar (risky use, like Raise): Overgrowth is anchored to the leader — a nearby ally no longer extends its reach', () => {
    let s = freshGame({ board: makeBoard() });
    debugSpawn(s, 'thornfang', 0, { col: 4, row: 5 }); // an ally standing right on the target line
    s.players[0].sp = 10;
    // Briar is still home at (4,1) — the ally's presence no longer grants reach.
    expect(() => applyAction(s, {
      t: 'ActivateAbility',
      targets: [{ col: 3, row: 5 }, { col: 4, row: 5 }, { col: 5, row: 5 }],
    })).toThrow(/leader's reach/);
    // March Briar forward (exposing a 20-ATK leader) and the same line becomes reachable.
    teleport(s, 'leader0', { col: 4, row: 4 });
    s = applyAction(s, {
      t: 'ActivateAbility',
      targets: [{ col: 3, row: 5 }, { col: 4, row: 5 }, { col: 5, row: 5 }],
    });
    expect(tileAt(s.board, { col: 5, row: 5 }).terrain).toBe('Forest');
  });
});

describe('Sim 5 — conditions read EFFECTIVE stats (Grave Tyrant, sim-1 gap #8)', () => {
  it('destroy-ATK≤20 kills a base-20 body, but fizzles when terrain lifts it to 40', () => {
    // Case 1: Sapling Sentry at effective 20 — destroyed on summon.
    let s = freshGame({ board: makeBoard() });
    const sentry = debugSpawn(s, 'saplingSentry', 0, { col: 4, row: 4 });
    s = endUntil(s, 1);
    s.players[1].sp = 12;
    s.players[1].hand = ['graveTyrant'];
    s = applyAction(s, { t: 'Summon', card: 'graveTyrant', tile: { col: 4, row: 6 } });
    expect(s.units[sentry.id]).toBeUndefined();

    // Case 2: same card on Forest (20 + 10 terrain + 10 Briar = 40 effective) — fizzles.
    let s2 = freshGame({ board: makeBoard() });
    const sentry2 = debugSpawn(s2, 'saplingSentry', 0, { col: 4, row: 4 });
    tileAt(s2.board, { col: 4, row: 4 }).terrain = 'Forest';
    s2 = endUntil(s2, 1);
    s2.players[1].sp = 12;
    s2.players[1].hand = ['graveTyrant'];
    s2 = applyAction(s2, { t: 'Summon', card: 'graveTyrant', tile: { col: 4, row: 6 } });
    expect(s2.units[sentry2.id]).toBeDefined(); // the effective reading made it fizzle
  });
});
