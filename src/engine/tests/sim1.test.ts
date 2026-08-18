// Simulation 1 — Results & Findings: opening economy, springs, multi-summon,
// paint-under-stationary, fusion, token/cap semantics.
import { describe, expect, it } from 'vitest';
import { makeBoard, tileAt, leaderOf } from '../board';
import { effectiveAtk } from '../stats';
import { applyAction, debugSpawn, isSick, legalActions, spMax } from '../engine';
import { autoBurn, freshGame, withLegacySpCurve, withSummoningSickness } from './helpers';

// These narratives were transcribed from the vault sims, which were played under the 1-turn
// summoning-sickness rule. The tester's default became 0 on 2026-08-01; pin the rule the sim
// was written for so the transcript keeps testing what it recorded.
withSummoningSickness();
// ...and the pre-2026-08-09 SP curve (4/7/8). The shipping step is now 1, so the live curve is
// 4/5/6/7/8 — but this file replays a recorded sim, so it keeps testing the rules that sim ran on.
withLegacySpCurve();

describe('Sim 1 — SP economy (refresh, not accrual)', () => {
  it('curve runs 4/7/8 capped at 8, refreshed regardless of spending', () => {
    // 2026-07-17 economy experiment: cap flattened from the vault-scripted 12 to 8.
    expect(spMax(1)).toBe(4);
    expect(spMax(2)).toBe(7);
    expect(spMax(3)).toBe(8);
    expect(spMax(4)).toBe(8);
    expect(spMax(9)).toBe(8);

    let s = freshGame();
    expect(s.players[0].sp).toBe(4);
    s = applyAction(s, { t: 'EndTurn' });
    expect(s.players[1].sp).toBe(5); // going-second coin: 4 + 1, turn 1 only
    s = applyAction(s, { t: 'EndTurn' });
    expect(s.players[0].sp).toBe(7);
    s = autoBurn(applyAction(s, { t: 'EndTurn' }));
    expect(s.players[1].sp).toBe(7); // coin gone — non-permanent
    s = autoBurn(applyAction(s, { t: 'EndTurn' }));
    expect(s.players[0].sp).toBe(8);
    s = autoBurn(applyAction(s, { t: 'EndTurn' }));
    expect(s.players[1].sp).toBe(8);
    s = autoBurn(applyAction(s, { t: 'EndTurn' }));
    expect(s.players[0].sp).toBe(8);
    s = autoBurn(applyAction(s, { t: 'EndTurn' }));
    s = autoBurn(applyAction(s, { t: 'EndTurn' }));
    expect(s.players[0].sp).toBe(8); // cap holds
  });

  it('unspent SP expires at end of turn (refresh model)', () => {
    let s = freshGame();
    expect(s.players[0].sp).toBe(4); // spent nothing
    s = applyAction(s, { t: 'EndTurn' });
    expect(s.players[0].sp).toBe(0); // discarded, not banked
    s = applyAction(s, { t: 'EndTurn' });
    expect(s.players[0].sp).toBe(7); // refreshed to curve, no carryover
  });
});

describe('Sim 1 — hand & deck economy', () => {
  it('starting hand 5 plus the turn draw', () => {
    const s = freshGame();
    // TODO(open): P1's first draw is NOT skipped (sim-1 gap #1, unresolved in the vault).
    expect(s.players[0].hand.length).toBe(6);
    expect(s.players[1].hand.length).toBe(5);
    const s2 = applyAction(s, { t: 'EndTurn' });
    expect(s2.players[1].hand.length).toBe(6);
  });

  it('deck-out: at an empty deck you simply stop drawing — never a loss', () => {
    let s = freshGame();
    s.players[0].deck = [];
    const handBefore = s.players[0].hand.length;
    s = applyAction(s, { t: 'EndTurn' });
    s = applyAction(s, { t: 'EndTurn' }); // P1 draws nothing, no error, no loss
    expect(s.players[0].hand.length).toBe(handBefore);
    expect(s.winner).toBeUndefined();
  });
});

describe('Sim 1 — summoning', () => {
  it('multi-summon: SP-and-space-bounded, not count-bounded', () => {
    let s = freshGame();
    s.players[0].hand = ['saplingSentry', 'saplingSentry', 'saplingSentry'];
    s = applyAction(s, { t: 'Summon', card: 'saplingSentry', tile: { col: 3, row: 1 } });
    s = applyAction(s, { t: 'Summon', card: 'saplingSentry', tile: { col: 5, row: 1 } });
    expect(s.players[0].sp).toBe(0); // 4 − 2 − 2
    // Third summon dies on SP, not on any per-turn count.
    expect(() => applyAction(s, { t: 'Summon', card: 'saplingSentry', tile: { col: 3, row: 2 } }))
      .toThrow(/not enough SP/);
  });

  it('summons go only to the leader surrounding-8, onto empty tiles', () => {
    const s = freshGame();
    s.players[0].hand = ['saplingSentry'];
    expect(() => applyAction(s, { t: 'Summon', card: 'saplingSentry', tile: { col: 4, row: 4 } }))
      .toThrow(/summon zone/);
  });

  it('summoned units are sick: cannot attack, still move/defend/strike back', () => {
    let s = freshGame();
    debugSpawn(s, 'carrionSwarm', 1, { col: 3, row: 2 });
    s.players[0].hand = ['mosshideBull'];
    s.players[0].sp = 12;
    s = applyAction(s, { t: 'Summon', card: 'mosshideBull', tile: { col: 3, row: 1 } });
    const bull = Object.values(s.units).find((u) => u.cardId === 'mosshideBull')!;
    expect(isSick(bull)).toBe(true);
    expect(() => applyAction(s, { t: 'Move', unit: bull.id, to: { col: 3, row: 2 } }))
      .toThrow(/summoning-sick/);
    // Sickness clears at the start of the controller's next turn.
    s = applyAction(s, { t: 'EndTurn' });
    s = applyAction(s, { t: 'EndTurn' });
    expect(isSick(s.units[bull.id]!)).toBe(false);
  });

  it('field cap: 5 real units; tokens are exempt (bounded spatially, not numerically)', () => {
    let s = freshGame();
    for (let i = 0; i < 4; i++) debugSpawn(s, 'saplingSentry', 0, { col: i + 1, row: 3 });
    const shambler = debugSpawn(s, 'duneshambler', 0, { col: 5, row: 3 }); // 5th real unit (P1-owned for the test)
    // Kill the shambler so its OnDeath spawns a Husk token for its owner.
    const killer = debugSpawn(s, 'apexPredator', 1, { col: 6, row: 3 });
    void killer;
    s.units[shambler.id]!.baseAtk = 1;
    let s2 = applyAction(s, { t: 'EndTurn' });
    s2 = applyAction(s2, { t: 'Move', unit: killer.id, to: { col: 5, row: 3 } });
    // Token exists and does not consume a real-unit slot, and it got summoning sickness.
    const husk = Object.values(s2.units).find((u) => u.isToken);
    expect(husk).toBeDefined();
    expect(husk!.owner).toBe(0);
    expect(isSick(husk!)).toBe(true);
  });

  it('a 6th real summon is rejected at the cap', () => {
    const s = freshGame();
    for (let i = 0; i < 5; i++) debugSpawn(s, 'saplingSentry', 0, { col: i + 1, row: 3 });
    s.players[0].hand = ['saplingSentry'];
    s.players[0].sp = 12;
    expect(() => applyAction(s, { t: 'Summon', card: 'saplingSentry', tile: { col: 3, row: 1 } }))
      .toThrow(/unit cap/);
  });
});

describe('Sim 1 — springs', () => {
  it('capture gives +3 that OVERFLOWS the cap for the turn, then expires', () => {
    let s = freshGame();
    const u = debugSpawn(s, 'thornfang', 0, { col: 1, row: 4 });
    s.players[0].sp = 8; // simulate a cap turn
    s = applyAction(s, { t: 'Move', unit: u.id, to: { col: 2, row: 4 } });
    expect(s.players[0].sp).toBe(11); // the only repeatable way to break the ceiling
    expect(tileAt(s.board, { col: 2, row: 4 }).springActive).toBe(false); // dormant
    s = applyAction(s, { t: 'EndTurn' });
    s = applyAction(s, { t: 'EndTurn' });
    expect(s.players[0].sp).toBe(7); // spike expired; back on the curve
  });

  it('relights 3 rounds after capture; occupying at relight = immediate capture (sim-1 ruling)', () => {
    let s = freshGame();
    const u = debugSpawn(s, 'thornfang', 0, { col: 1, row: 4 });
    s = applyAction(s, { t: 'Move', unit: u.id, to: { col: 2, row: 4 } }); // capture in round 1
    expect(tileAt(s.board, { col: 2, row: 4 }).springRelightRound).toBe(4);
    // Park the unit; 6 end-turns reach the start of P1's round-4 turn.
    for (let i = 0; i < 5; i++) {
      s = autoBurn(applyAction(s, { t: 'EndTurn' }));
      expect(tileAt(s.board, { col: 2, row: 4 }).springActive).toBe(false);
    }
    s = autoBurn(applyAction(s, { t: 'EndTurn' })); // start of P1 turn, round 4: relight + occupant captures
    expect(s.round).toBe(4);
    expect(s.players[0].sp).toBe(8 + 3);
    expect(tileAt(s.board, { col: 2, row: 4 }).springActive).toBe(false); // captured again immediately
    expect(tileAt(s.board, { col: 2, row: 4 }).springRelightRound).toBe(7);
  });
});

describe('Sim 1 — the architecture star: paint under a STATIONARY unit', () => {
  it('Verdant Surge flips Grovecaller buffs on without it moving', () => {
    let s = freshGame({ board: makeBoard() }); // all-Normal board isolates the aura
    const g = debugSpawn(s, 'grovecaller', 0, { col: 4, row: 3 });
    expect(effectiveAtk(s, g)).toBe(25);
    s.players[0].hand.push('verdantSurge');
    s = applyAction(s, {
      t: 'CastSpell',
      card: 'verdantSurge',
      targets: [{ col: 3, row: 2 }, { col: 4, row: 2 }, { col: 5, row: 2 }],
    });
    // All three painted tiles sit in Grovecaller's surrounding-8: +5 each, no move needed.
    expect(effectiveAtk(s, s.units[g.id]!)).toBe(40);
    expect(s.units[g.id]!.pos).toEqual({ col: 4, row: 3 }); // never moved
    expect(tileAt(s.board, { col: 4, row: 2 }).terrain).toBe('Forest');
  });

  it('located spells cannot reach distant tiles from hand (set-and-travel instead)', () => {
    const s = freshGame({ board: makeBoard() });
    s.players[0].hand.push('verdantSurge');
    expect(() => applyAction(s, {
      t: 'CastSpell',
      card: 'verdantSurge',
      targets: [{ col: 3, row: 6 }, { col: 4, row: 6 }, { col: 5, row: 6 }],
    })).toThrow(/out of reach/);
  });
});

describe('Sim 1 — fusion executes cleanly', () => {
  it('move-on consumes both materials; fused unit on the stationary tile, sick', () => {
    let s = freshGame();
    const thorn = debugSpawn(s, 'thornfang', 0, { col: 4, row: 4 });
    const bull = debugSpawn(s, 'mosshideBull', 0, { col: 4, row: 5 });
    s = applyAction(s, { t: 'Move', unit: thorn.id, to: { col: 4, row: 5 } });
    const apex = Object.values(s.units).find((u) => u.cardId === 'apexPredator');
    expect(apex).toBeDefined();
    expect(apex!.pos).toEqual({ col: 4, row: 5 }); // destination = stationary material's tile
    expect(isSick(apex!)).toBe(true);        // no fuse-and-swing burst
    expect(s.units[thorn.id]).toBeUndefined();
    expect(s.units[bull.id]).toBeUndefined();
    expect(s.players[0].fusionPool).toEqual([]);   // out of the pool
    expect(tileAt(s.board, { col: 4, row: 4 }).occupant).toBeUndefined(); // mover's tile freed
  });

  it('moving onto a friendly NON-pair unit is illegal', () => {
    const s = freshGame();
    const a = debugSpawn(s, 'thornfang', 0, { col: 4, row: 4 });
    debugSpawn(s, 'saplingSentry', 0, { col: 4, row: 5 });
    expect(() => applyAction(s, { t: 'Move', unit: a.id, to: { col: 4, row: 5 } }))
      .toThrow(/fusion pair/);
  });
});

describe('Sim 1 — self-clog: the board is a real cost', () => {
  it('own units block the summon zone (legalActions shrinks)', () => {
    const s = freshGame();
    const leader = leaderOf(s, 0);
    // Choke every tile around the leader except one.
    const ring = [
      { col: 3, row: 1 }, { col: 5, row: 1 }, { col: 3, row: 2 }, { col: 4, row: 2 },
    ];
    for (const c of ring) debugSpawn(s, 'saplingSentry', 0, c);
    void leader;
    s.players[0].hand = ['saplingSentry'];
    s.players[0].sp = 4;
    const summons = legalActions(s).filter((a) => a.t === 'Summon');
    expect(summons.length).toBe(1); // only (5,2) remains open
  });
});
