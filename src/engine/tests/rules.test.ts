// The tunable ruleset (`RULES`). These are the tester's knobs, so the contract that matters
// is that changing one actually changes engine behavior — a knob the engine ignores is worse
// than no knob, because a playtest would draw conclusions from a setting that did nothing.

import { afterEach, describe, expect, it } from 'vitest';
import { applyAction, debugSpawn, isSick, legalActions, spMax } from '../engine';
import { makeBoard } from '../board';
import { arenaLayout, boardFromLayout } from '../boardLayout';
import { changedRules, RULES, RULES_DEFAULTS, resetRules, setRules } from '../rules';
import { autoBurn, freshGame } from './helpers';
import type { GameState } from '../types';

afterEach(resetRules); // RULES is global — a leak would corrupt every later test

describe('RULES plumbing', () => {
  it('starts at the shipping defaults with nothing marked changed', () => {
    expect(RULES).toEqual(RULES_DEFAULTS);
    expect(changedRules()).toEqual([]);
  });

  it('setRules patches only the named keys, and reset restores everything', () => {
    setRules({ startingLife: 120 });
    expect(RULES.startingLife).toBe(120);
    expect(RULES.handCap).toBe(RULES_DEFAULTS.handCap);
    expect(changedRules()).toEqual(['startingLife']);
    resetRules();
    expect(RULES).toEqual(RULES_DEFAULTS);
  });
});

describe('knobs actually reach the engine', () => {
  it('startingLife sets the LP both players begin on', () => {
    setRules({ startingLife: 90 });
    const s = freshGame();
    expect(s.players[0].leaderLife).toBe(90);
    expect(s.players[1].leaderLife).toBe(90);
  });

  it('startingHand sets the opening draw', () => {
    const base = freshGame().players[1].hand.length; // P2 hasn't taken a turn, so no draw on top
    setRules({ startingHand: RULES_DEFAULTS.startingHand - 2 });
    expect(freshGame().players[1].hand.length).toBe(base - 2);
  });

  it('spMax follows spBase / spStep / spCap', () => {
    expect([1, 2, 3, 4, 5].map(spMax)).toEqual([4, 5, 6, 7, 8]); // shipping 4/+1/cap 8 since 2026-08-09
    setRules({ spBase: 2, spStep: 1, spCap: 4 });
    expect([1, 2, 3, 4, 5].map(spMax)).toEqual([2, 3, 4, 4, 4]);
  });

  it('fatigueStep scales empty-deck damage', () => {
    setRules({ fatigueStep: 25 });
    let s = freshGame();
    s.players[1].deck = [];
    s = applyAction(s, { t: 'EndTurn' }); // P2's start-of-turn draw misses
    expect(s.players[1].fatigue).toBe(1);
    expect(s.players[1].leaderLife).toBe(RULES.startingLife - 25);
  });

  it('handCap sets where the forced burn kicks in', () => {
    let s = freshGame();
    setRules({ handCap: s.players[0].hand.length }); // P1 is exactly at the new cap
    s = applyAction(s, { t: 'EndTurn' });
    expect(s.pendingBurn).toBeUndefined(); // P2's own draw only reaches the cap
    s = applyAction(s, { t: 'EndTurn' }); // back to P1, whose draw goes over
    expect(s.pendingBurn?.player).toBe(0);
    s = autoBurn(s);
    expect(s.pendingBurn).toBeUndefined();
  });

  it('unitCap bounds how many units a player can field', () => {
    setRules({ unitCap: 2 });
    const s = freshGame();
    debugSpawn(s, 'saplingSentry', 0, { col: 3, row: 2 });
    debugSpawn(s, 'saplingSentry', 0, { col: 4, row: 2 });
    expect(legalActions(s).some((a) => a.t === 'Summon')).toBe(false);
    setRules({ unitCap: 3 });
    expect(legalActions(s).some((a) => a.t === 'Summon')).toBe(true);
  });

  it('nonUnitCap bounds face-down spells/traps (a face-down UNIT is a unit-cap slot)', () => {
    const s = freshGame();
    s.players[0].hand.push('verdantSurge'); // the opening hand isn't guaranteed to hold a spell
    const spellSets = () =>
      legalActions(s).filter((a) => a.t === 'SetCard' && s.cardDefs[a.card]!.kind !== 'unit');
    expect(spellSets().length).toBeGreaterThan(0);
    setRules({ nonUnitCap: 0 });
    expect(spellSets()).toEqual([]);
    expect(legalActions(s).some((a) => a.t === 'SetCard')).toBe(true); // units still settable
  });

  /** Summon the first affordable unit through the real action path (debugSpawn bypasses the knob). */
  function summonOne(s: GameState): { state: GameState; unitId: string } {
    const before = new Set(Object.keys(s.units));
    const summon = legalActions(s).find((a) => a.t === 'Summon');
    if (!summon) throw new Error('no legal summon in the opening hand');
    const state = applyAction(s, summon);
    const unitId = Object.keys(state.units).find((id) => !before.has(id))!;
    return { state, unitId };
  }

  it('summoningSickTurns is the sickness a real summon arrives with', () => {
    const hasty = summonOne(freshGame());
    expect(hasty.state.units[hasty.unitId]!.sickTurns).toBe(0); // the shipping rule since 2026-08-01
    expect(isSick(hasty.state.units[hasty.unitId]!)).toBe(false);
    setRules({ summoningSickTurns: 1 });
    const standard = summonOne(freshGame());
    expect(standard.state.units[standard.unitId]!.sickTurns).toBe(1);
    expect(isSick(standard.state.units[standard.unitId]!)).toBe(true);
  });

  it('at 0 a summoned unit can attack the turn it arrives', () => {
    setRules({ summoningSickTurns: 0 });
    const s = freshGame({ board: makeBoard(() => 'Normal') });
    const { state, unitId } = summonOne(s);
    // Park a victim it can reach, then swing on the same turn it landed.
    const fresh = state.units[unitId]!;
    const victim = debugSpawn(state, 'saplingSentry', 1, { col: fresh.pos.col, row: fresh.pos.row + 1 });
    expect(legalActions(state).some((a) => a.t === 'Move' && a.unit === unitId)).toBe(true);
    const end = applyAction(state, { t: 'Move', unit: unitId, to: victim.pos });
    expect(end.units[victim.id] === undefined || end.units[unitId] === undefined).toBe(true); // combat resolved
  });

  it('above 1 the sickness ticks down only on the owner’s own turns', () => {
    setRules({ summoningSickTurns: 3 });
    let { state: s, unitId } = summonOne(freshGame());
    expect(s.units[unitId]!.sickTurns).toBe(3);
    s = applyAction(s, { t: 'EndTurn' }); // P2's turn — not the owner's
    expect(s.units[unitId]!.sickTurns).toBe(3);
    s = applyAction(s, { t: 'EndTurn' }); // back to P1
    expect(s.units[unitId]!.sickTurns).toBe(2);
    expect(isSick(s.units[unitId]!)).toBe(true);
    for (let i = 0; i < 4; i++) {
      s = autoBurn(s);
      s = applyAction(s, { t: 'EndTurn' });
    }
    expect(s.units[unitId]!.sickTurns).toBe(0);
    expect(isSick(s.units[unitId]!)).toBe(false);
  });

  it('an explicit debugSpawn sick flag still yields a sick unit when the knob is 0', () => {
    setRules({ summoningSickTurns: 0 });
    const s = freshGame();
    expect(isSick(debugSpawn(s, 'thornfang', 0, { col: 4, row: 2 }, { sick: true }))).toBe(true);
  });

  // Mirrors flank.test.ts's "+5 turns the tie into a kill" case, with the knob turned off.
  it('flankPerAlly 0 takes flanking back out of combat', () => {
    const setup = () => {
      const s = freshGame({ board: makeBoard(() => 'Normal') });
      const atk = debugSpawn(s, 'thornfang', 0, { col: 4, row: 4 }); // 30
      const def = debugSpawn(s, 'duneshambler', 1, { col: 4, row: 5 }); // 30
      debugSpawn(s, 'saplingSentry', 0, { col: 3, row: 5 }); // ally adjacent to the defender
      return { s, atk, def };
    };

    const on = setup();
    const won = applyAction(on.s, { t: 'Move', unit: on.atk.id, to: on.def.pos });
    expect(won.units[on.atk.id]).toBeDefined(); // +5 breaks the tie
    expect(won.units[on.def.id]).toBeUndefined();

    setRules({ flankPerAlly: 0 });
    const off = setup();
    const traded = applyAction(off.s, { t: 'Move', unit: off.atk.id, to: off.def.pos });
    expect(traded.units[off.atk.id]).toBeUndefined(); // back to mutual destruction
    expect(traded.units[off.def.id]).toBeUndefined();
  });
  it('sigilTurns 0 makes an unspecified sigil inert', () => {
    const at = { col: 4, row: 4 };
    const walk = () => {
      const s = freshGame({ board: boardFromLayout({ ...arenaLayout(), sigils: [{ at }] }) });
      const u = debugSpawn(s, 'thornfang', 0, { col: 4, row: 3 });
      return applyAction(s, { t: 'Move', unit: u.id, to: at }).units[u.id]!;
    };
    expect(walk().statuses).not.toEqual([]); // default: a 2-turn stun

    setRules({ sigilTurns: 0 });
    expect(walk().statuses).toEqual([]);
  });

  it('sigilStatus/sigilAmount pick what an unspecified sigil applies', () => {
    setRules({ sigilStatus: 'AtkMod', sigilAmount: -25, sigilTurns: 1 });
    const board = boardFromLayout({ ...arenaLayout(), sigils: [{ at: { col: 4, row: 4 } }] });
    expect(board[3]![3]!.sigil).toEqual({ status: 'AtkMod', amount: -25, turns: 1 });
  });
});
