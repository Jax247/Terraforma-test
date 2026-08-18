// Phases 5 & 6 — the two positional rules experiments, both behind RULES knobs defaulting OFF.
//
//   supportRange       bounds leader passive auras (ATK and DEF) and located-ability reach
//   favoredTerrainMove +N movement while standing on your own favored terrain
//
// Both land inert: with the knobs at 0 every existing game is byte-identical, which the rest of
// the suite pins. These tests flip them explicitly and restore in afterEach.

import { afterEach, describe, expect, it } from 'vitest';
import { makeBoard } from '../board';
import { effectiveAtk, effectiveDef, favoredTerrain } from '../stats';
import { applyAction, debugSpawn, initGame, legalActions } from '../engine';
import { enumerateBoundActions } from '../targeting';
import { resetRules, setRules } from '../rules';
import { OSKAR, POC_CARDS, POC_TOKENS } from '../content/poc';
import { teleport } from './helpers';
import type { AbilityDef, CardDef, GameState, LeaderDef, Rule } from '../types';

afterEach(() => resetRules());

const BLANK: CardDef = {
  kind: 'unit', id: 'blank', name: 'Blank', type: 'Beast',
  level: 1, atk: 20, def: 20, dc: 1, keywords: [], rules: [],
};
const NO_ABILITY = { id: 'noop', name: 'No-op', cost: 99, located: false, effects: [] };

const leaderWith = (rules: Rule[], ability: AbilityDef = NO_ABILITY): LeaderDef =>
  ({ id: 'probe', name: 'Probe', type: 'Warrior', atk: 30, rules, ability });

function game(leader?: LeaderDef, cards: Record<string, CardDef> = {}): GameState {
  const deck = Array.from({ length: 40 }, () => 'blank');
  return initGame({
    board: makeBoard(),
    cardDefs: { ...POC_CARDS, blank: BLANK, ...cards },
    tokenDefs: POC_TOKENS,
    players: [
      { leader: leader ?? leaderWith([]), deck, fusionPool: [] },
      { leader: OSKAR, deck: [...deck], fusionPool: [] },
    ],
  });
}

/** Neutralise terrain under a tile so stat assertions read only what is under test. */
const flatten = (s: GameState, c: { col: number; row: number }) => {
  s.board[c.col - 1]![c.row - 1]!.terrain = 'Normal';
};

// ---------------------------------------------------------------------------
// Phase 5 — Support Range
// ---------------------------------------------------------------------------

describe('Support Range — the aura radius', () => {
  const banner = leaderWith([{
    trigger: 'Passive', effect: { e: 'AuraAtk', amount: 10 },
    target: { t: 'FriendlyOfTypes', types: ['Beast'] },
  }]);

  it('is OFF by default: the aura still reaches across the whole board', () => {
    const s = game(banner);
    const far = debugSpawn(s, 'blank', 0, { col: 7, row: 7 });
    flatten(s, far.pos);
    expect(effectiveAtk(s, far)).toBe(30);
  });

  it('applies in range and stops out of range once enabled', () => {
    setRules({ supportRange: 1 });
    const s = game(banner);
    const lead = s.units['leader0']!.pos;
    const near = debugSpawn(s, 'blank', 0, { col: lead.col + 1, row: lead.row + 1 }); // diagonal = in
    const far = debugSpawn(s, 'blank', 0, { col: lead.col + 2, row: lead.row });
    flatten(s, near.pos);
    flatten(s, far.pos);
    expect(effectiveAtk(s, near)).toBe(30);
    expect(effectiveAtk(s, far)).toBe(20);
  });

  it('bounds DEF auras too, not just ATK — they share the gate', () => {
    setRules({ supportRange: 1 });
    const warden = leaderWith([{
      trigger: 'Passive', effect: { e: 'AuraDef', amount: 20 },
      target: { t: 'FriendlyOfTypes', types: ['Beast'] },
    }]);
    const s = game(warden);
    const lead = s.units['leader0']!.pos;
    const near = debugSpawn(s, 'blank', 0, { col: lead.col + 1, row: lead.row });
    const far = debugSpawn(s, 'blank', 0, { col: lead.col + 3, row: lead.row });
    flatten(s, near.pos);
    flatten(s, far.pos);
    expect(effectiveDef(s, near)).toBe(40);
    expect(effectiveDef(s, far)).toBe(20);
  });

  it('the leader itself always qualifies for a Self aura', () => {
    setRules({ supportRange: 1 });
    const vain = leaderWith([{
      trigger: 'Passive', effect: { e: 'AuraAtk', amount: 15 }, target: { t: 'Self' },
    }]);
    const s = game(vain);
    const lead = s.units['leader0']!;
    flatten(s, lead.pos);
    expect(effectiveAtk(s, lead)).toBe(45);
  });

  it('the aura follows the leader, so moving it turns units on and off', () => {
    setRules({ supportRange: 1 });
    const s = game(banner);
    const u = debugSpawn(s, 'blank', 0, { col: 1, row: 5 });
    flatten(s, u.pos);
    expect(effectiveAtk(s, u)).toBe(20);
    teleport(s, 'leader0', { col: 1, row: 4 });
    expect(effectiveAtk(s, u)).toBe(30);
  });
});

describe('Support Range — the summoning carve-out', () => {
  it('does NOT extend the summon zone, even at radius 2', () => {
    // The whole point of the carve-out: the summon zone is the 8 surrounding tiles at ANY radius.
    setRules({ supportRange: 2 });
    const s = game();
    const lead = s.units['leader0']!.pos;
    s.players[0].hand.push('blank');
    s.players[0].sp = 8;
    const twoAway = { col: lead.col + 2, row: lead.row };
    expect(() => applyAction(s, { t: 'Summon', card: 'blank', tile: twoAway }))
      .toThrow(/summon zone/);
    // ...while the adjacent tile still works.
    const oneAway = { col: lead.col + 1, row: lead.row };
    expect(() => applyAction(s, { t: 'Summon', card: 'blank', tile: oneAway })).not.toThrow();
  });
});

describe('Support Range — located ability reach', () => {
  const zap: LeaderDef = leaderWith([], {
    id: 'zap', name: 'Zap', cost: 1, located: true,
    effects: [{ effect: { e: 'Damage', amount: 10 }, target: { t: 'ChosenEnemy' } }],
  });

  it('a located ability reaches further when the radius widens', () => {
    setRules({ supportRange: 2 });
    const s = game(zap);
    const lead = s.units['leader0']!.pos;
    const target = { col: lead.col + 2, row: lead.row };
    debugSpawn(s, 'blank', 1, target);
    s.players[0].sp = 8;
    expect(() => applyAction(s, { t: 'ActivateAbility', targets: [target] })).not.toThrow();
  });

  it('...and is refused at that distance while the knob is off', () => {
    const s = game(zap);
    const lead = s.units['leader0']!.pos;
    const target = { col: lead.col + 2, row: lead.row };
    debugSpawn(s, 'blank', 1, target);
    s.players[0].sp = 8;
    expect(() => applyAction(s, { t: 'ActivateAbility', targets: [target] }))
      .toThrow(/out of the leader's reach/);
  });

  it('located SPELL reach does NOT follow the knob — that is a spell rule', () => {
    setRules({ supportRange: 2 });
    const s = game();
    const lead = s.units['leader0']!.pos;
    s.players[0].hand.push('verdantSurge'); // poc located spell
    s.players[0].sp = 8;
    const twoAway = { col: lead.col + 2, row: lead.row };
    expect(() => applyAction(s, { t: 'CastSpell', card: 'verdantSurge', targets: [twoAway] }))
      .toThrow(/out of reach/);
  });

  it('DESYNC GUARD: the AI enumerates exactly the ability targets the engine accepts', () => {
    // The reach rule is implemented twice — engine in doActivateAbility, AI in targeting.inReach.
    // The mismatch is BIDIRECTIONAL and both halves have to be asserted:
    //   too permissive -> the bot proposes actions the engine rejects;
    //   too restrictive -> the bot silently never uses its ability's real reach.
    // Only checking "everything offered is legal" catches the first and misses the second, which
    // is exactly what the `inReach ignores max` mutation exposed.
    setRules({ supportRange: 2 });
    const s = game(zap);
    const lead = s.units['leader0']!.pos;
    const spots = ([[1, 0], [2, 0], [0, 2], [2, 2]] as const)
      .map((d) => ({ col: lead.col + d[0], row: lead.row + d[1] }))
      .filter((c) => c.col <= 7 && c.row <= 7);
    for (const c of spots) debugSpawn(s, 'blank', 1, c);
    s.players[0].sp = 8;

    const acts = enumerateBoundActions(s).filter((a) => a.t === 'ActivateAbility');
    // (a) nothing offered is illegal
    for (const a of acts) expect(() => applyAction(s, a), JSON.stringify(a)).not.toThrow();

    // (b) nothing LEGAL is missing — every enemy inside radius 2 must be offered, including the
    //     distance-2 ones that a stale `<= 1` would silently drop.
    const offered = new Set(
      acts.flatMap((a) => (a.t === 'ActivateAbility' ? a.targets ?? [] : [])).map((c) => `${c.col},${c.row}`),
    );
    for (const c of spots) {
      expect(offered.has(`${c.col},${c.row}`), `radius-2 target ${c.col},${c.row} not offered`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Phase 6 — favored-terrain movement
// ---------------------------------------------------------------------------

describe('favored-terrain movement', () => {
  /** Blank is a Beast, so Forest is its favored ground. */
  const FAVORED = favoredTerrain('Beast');

  const moveTargets = (s: GameState, id: string) =>
    legalActions(s).filter((a) => a.t === 'Move' && a.unit === id);

  it('is ON by default — ADOPTED 2026-08-06', () => {
    const s = game();
    const u = debugSpawn(s, 'blank', 0, { col: 4, row: 4 });
    s.board[3]![3]!.terrain = FAVORED;
    const far = { col: 4, row: 6 }; // 2 tiles away
    expect(moveTargets(s, u.id).some((a) => a.t === 'Move' && a.to.col === far.col && a.to.row === far.row)).toBe(true);
  });

  it('can still be turned off, which is what restores the pre-adoption rule', () => {
    setRules({ favoredTerrainMove: 0 });
    const s = game();
    const u = debugSpawn(s, 'blank', 0, { col: 4, row: 4 });
    s.board[3]![3]!.terrain = FAVORED;
    const far = { col: 4, row: 6 };
    expect(moveTargets(s, u.id).some((a) => a.t === 'Move' && a.to.col === far.col && a.to.row === far.row)).toBe(false);
  });

  it('grants the bonus only on the unit\'s OWN favored terrain', () => {
    setRules({ favoredTerrainMove: 1 });
    const s = game();
    const u = debugSpawn(s, 'blank', 0, { col: 4, row: 4 });
    const twoAway = { col: 4, row: 6 };
    const canReachTwo = () =>
      moveTargets(s, u.id).some((a) => a.t === 'Move' && a.to.col === twoAway.col && a.to.row === twoAway.row);

    s.board[3]![3]!.terrain = 'Normal';
    expect(canReachTwo()).toBe(false);
    s.board[3]![3]!.terrain = 'Desert'; // Beast's WEAK terrain
    expect(canReachTwo()).toBe(false);
    s.board[3]![3]!.terrain = FAVORED;
    expect(canReachTwo()).toBe(true);
  });

  it('stacks with extraMove', () => {
    setRules({ favoredTerrainMove: 1 });
    const s = game();
    const u = debugSpawn(s, 'blank', 0, { col: 4, row: 4 });
    s.board[3]![3]!.terrain = FAVORED;
    u.extraMove = 1; // 1 base + 1 granted + 1 terrain = 3
    const threeAway = { col: 4, row: 7 };
    expect(moveTargets(s, u.id).some((a) => a.t === 'Move' && a.to.col === threeAway.col && a.to.row === threeAway.row)).toBe(true);
  });

  it('applies to the leader too', () => {
    setRules({ favoredTerrainMove: 1 });
    const s = game(); // probe leader is a Warrior
    const lead = s.units['leader0']!;
    s.board[lead.pos.col - 1]![lead.pos.row - 1]!.terrain = favoredTerrain('Warrior');
    const twoAway = { col: lead.pos.col, row: lead.pos.row + 2 };
    expect(moveTargets(s, 'leader0').some((a) => a.t === 'Move' && a.to.col === twoAway.col && a.to.row === twoAway.row)).toBe(true);
  });

  it('the extended move is actually legal, not just offered', () => {
    setRules({ favoredTerrainMove: 1 });
    const s = game();
    const u = debugSpawn(s, 'blank', 0, { col: 4, row: 4 });
    s.board[3]![3]!.terrain = FAVORED;
    const after = applyAction(s, { t: 'Move', unit: u.id, to: { col: 4, row: 6 } });
    expect(after.units[u.id]!.pos).toEqual({ col: 4, row: 6 });
  });
});
