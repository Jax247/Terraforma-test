// Leader rules — the four dispatch defects fixed on 2026-08-04, plus the static assertion that
// guards against the next one.
//
// All four were the SAME failure mode: content that parsed, type-checked, and silently did
// nothing. A type system cannot catch "this trigger has no call site", so each fix is pinned by
// a test that fails when the fix is reverted, and `validateLeader` covers the general case.

import { describe, expect, it } from 'vitest';
import { makeBoard } from '../board';
import { effectiveAtk, effectiveDef } from '../stats';
import { applyAction, debugSpawn, initGame } from '../engine';
import { validateLeader, DECKS, DEFENSE_DECKS } from '../content/decks';
import { BRIAR, OSKAR, POC_CARDS, POC_TOKENS } from '../content/poc';
import { KAELEN, SKYFIRE_CARDS, GREENWARDEN_CARDS } from '../content/simDecks';
import { freshGame, endUntil } from './helpers';
import type { CardDef, GameState, LeaderDef } from '../types';

// A leader whose every rule sits on a trigger the engine really dispatches, so each test can
// isolate one hook. Types match the poc cards so the auras have something to land on.
function leaderWith(rules: LeaderDef['rules'], atk = 30): LeaderDef {
  return {
    id: 'probe', name: 'Probe Leader', type: 'Warrior', atk,
    rules,
    ability: { id: 'noop', name: 'No-op', cost: 99, located: false, effects: [] },
  };
}

const PROBE_CARDS: Record<string, CardDef> = {
  ...POC_CARDS,
  probeBody: {
    kind: 'unit', id: 'probeBody', name: 'Probe Body', type: 'Beast',
    level: 1, atk: 20, def: 20, dc: 1, keywords: [], rules: [],
  },
  probeChaff: {
    kind: 'unit', id: 'probeChaff', name: 'Probe Chaff', type: 'Beast',
    level: 1, atk: 10, def: 10, dc: 1, keywords: [], rules: [],
  },
  probeSeed: {
    kind: 'spell', id: 'probeSeed', name: 'Probe Seed', dc: 1, sp: 1, scope: 'located',
    effects: [{ effect: { e: 'SummonToken', tokenId: 'sapling', count: 1 }, target: { t: 'AdjacentEmptyTiles' } }],
  },
};

function probeGame(leader: LeaderDef): GameState {
  return initGame({
    board: makeBoard(),
    cardDefs: PROBE_CARDS,
    tokenDefs: POC_TOKENS,
    players: [
      { leader, deck: Array.from({ length: 40 }, () => 'probeBody'), fusionPool: [] },
      { leader: OSKAR, deck: Array.from({ length: 40 }, () => 'probeBody'), fusionPool: [] },
    ],
  });
}

// ---------------------------------------------------------------------------
// Fix 1 — leader OnKill had no dispatch site
// ---------------------------------------------------------------------------

describe('leader OnKill fires', () => {
  it('a leader OnKill rule runs when the LEADER takes a kill', () => {
    // GainSP is observable and has no targeting subtleties.
    const leader = leaderWith([{ trigger: 'OnKill', effect: { e: 'GainSP', n: 3 }, target: { t: 'Self' } }]);
    const s = probeGame(leader);
    // 30 ATK leader vs a 20 ATK body: the leader wins and advances.
    const lead = s.units['leader0']!.pos;
    const target = { col: lead.col, row: lead.row + 1 };
    const prey = debugSpawn(s, 'probeBody', 1, target);
    const spBefore = s.players[0].sp;
    const after = applyAction(s, { t: 'Move', unit: 'leader0', to: target });
    expect(after.units[prey.id]).toBeUndefined();     // the kill happened
    expect(after.players[0].sp).toBe(spBefore + 3);   // ...and the leader rule fired
  });

  it('a leader OnKill rule does NOT fire when an ordinary unit takes the kill', () => {
    const leader = leaderWith([{ trigger: 'OnKill', effect: { e: 'GainSP', n: 3 }, target: { t: 'Self' } }]);
    const s = probeGame(leader);
    const killer = debugSpawn(s, 'probeBody', 0, { col: 2, row: 2 }); // 20 ATK
    debugSpawn(s, 'probeChaff', 1, { col: 2, row: 3 });                // 10 ATK — loses
    const spBefore = s.players[0].sp;
    const after = applyAction(s, { t: 'Move', unit: killer.id, to: { col: 2, row: 3 } });
    expect(after.players[0].sp).toBe(spBefore); // leader rules are the LEADER's, not the team's
  });
});

// ---------------------------------------------------------------------------
// Fix 2 — leader OnSummon had no hook at all
// ---------------------------------------------------------------------------

describe('leader OnSummon fires', () => {
  it('fires on a hard summon from hand, and binds the new unit as TriggeringUnit', () => {
    // GrantMove on the triggering unit — the "your summons arrive charging" shape, and it
    // proves the binding points at the summoned body rather than at the leader.
    const leader = leaderWith([
      { trigger: 'OnSummon', effect: { e: 'GrantMove', tiles: 1 }, target: { t: 'TriggeringUnit' } },
    ]);
    const s = probeGame(leader);
    s.players[0].hand.push('probeBody');
    s.players[0].sp = 8;
    const before = new Set(Object.keys(s.units));
    const after = applyAction(s, { t: 'Summon', card: 'probeBody', tile: { col: 4, row: 2 } });
    const summoned = Object.values(after.units).find((u) => !before.has(u.id));
    expect(summoned).toBeDefined();
    expect(summoned!.extraMove).toBe(1);
  });

  it('does NOT fire for token spawns — the hook is the SP-paying summon only', () => {
    const leader = leaderWith([
      { trigger: 'OnSummon', effect: { e: 'GainSP', n: 5 }, target: { t: 'Self' } },
    ]);
    const s = probeGame(leader);
    s.players[0].hand.push('probeSeed'); // located spell: SummonToken sapling
    s.players[0].sp = 8;
    const lead = s.units['leader0']!.pos;
    const spAfterCast = applyAction(s, {
      t: 'CastSpell', card: 'probeSeed', targets: [{ col: lead.col, row: lead.row + 1 }],
    });
    // Tokens arrived, but the leader was not paid for them.
    const tokens = Object.values(spAfterCast.units).filter((u) => u.isToken && u.owner === 0);
    expect(tokens.length).toBeGreaterThan(0);
    expect(spAfterCast.players[0].sp).toBe(7); // 8 − 1 cast, and NOT +5: the hook stayed shut
  });
});

// ---------------------------------------------------------------------------
// Fix 3 — conditional leader DEF auras were dropped on the floor
// ---------------------------------------------------------------------------

describe('conditional leader DEF auras apply', () => {
  const wardenRules: LeaderDef['rules'] = [{
    trigger: 'Passive',
    effect: { e: 'AuraDef', amount: 20 },
    target: { t: 'FriendlyOfTypes', types: ['Beast'] },
    condition: { k: 'NoAdjacentEnemy' },
  }];

  it('grants DEF while the recipient is unengaged, and withdraws it once an enemy closes', () => {
    const s = probeGame(leaderWith(wardenRules));
    const body = debugSpawn(s, 'probeBody', 0, { col: 4, row: 4 }); // Beast, base def 20
    const bare = effectiveDef(s, body);
    expect(bare).toBe(40); // 20 base + 20 aura, unengaged

    debugSpawn(s, 'probeBody', 1, { col: 4, row: 5 }); // an enemy closes orthogonally
    expect(effectiveDef(s, body)).toBe(20); // condition now false: the aura is gone
  });

  it('an unconditional DEF aura is unaffected by adjacency (isolates the condition)', () => {
    const s = probeGame(leaderWith([{
      trigger: 'Passive',
      effect: { e: 'AuraDef', amount: 20 },
      target: { t: 'FriendlyOfTypes', types: ['Beast'] },
    }]));
    const body = debugSpawn(s, 'probeBody', 0, { col: 4, row: 4 });
    debugSpawn(s, 'probeBody', 1, { col: 4, row: 5 });
    expect(effectiveDef(s, body)).toBe(40);
  });
});

// ---------------------------------------------------------------------------
// Fix 4 — movedThisTurn was cleared for EVERY unit, making the predicate inert
// ---------------------------------------------------------------------------

describe('DefenderUnmovedThisTurn denies the bonus in real play', () => {
  function skyfireGame(): GameState {
    return freshGame({
      board: makeBoard(),
      leaders: [KAELEN, OSKAR],
      extraCards: { ...SKYFIRE_CARDS, ...GREENWARDEN_CARDS },
    });
  }

  it('a defender that MOVED on its own turn still reads as moved on the attacker turn', () => {
    // The regression the fix targets: this whole sequence goes through startTurn, which is
    // where the flag used to be wiped for both sides.
    let s = skyfireGame();
    const hawk = debugSpawn(s, 'emberhawk', 0, { col: 4, row: 4 }); // Avian 30
    const golem = debugSpawn(s, 'bulwarkGolem', 1, { col: 4, row: 6 });

    s = endUntil(s, 1);
    s = applyAction(s, { t: 'Move', unit: golem.id, to: { col: 4, row: 5 } }); // defender moves
    s = endUntil(s, 0);                                                         // back to P1

    const ctx = { role: 'attacker' as const, battleTile: { col: 4, row: 5 }, opponentId: golem.id };
    expect(s.units[golem.id]!.movedThisTurn).toBe(true);   // survived the turn boundary
    expect(effectiveAtk(s, s.units[hawk.id]!, ctx)).toBe(30); // punish bonus correctly DENIED
  });

  it('a defender that sat still is punished', () => {
    let s = skyfireGame();
    const hawk = debugSpawn(s, 'emberhawk', 0, { col: 4, row: 4 });
    const golem = debugSpawn(s, 'bulwarkGolem', 1, { col: 4, row: 5 });

    s = endUntil(s, 1);
    s = endUntil(s, 0); // P2 does nothing at all

    const ctx = { role: 'attacker' as const, battleTile: golem.pos, opponentId: golem.id };
    expect(s.units[golem.id]!.movedThisTurn).toBe(false);
    expect(effectiveAtk(s, s.units[hawk.id]!, ctx)).toBe(35); // 30 + 5
  });

  it("a unit's own flag clears at the start of its own turn", () => {
    let s = freshGame({ board: makeBoard() });
    const body = debugSpawn(s, 'thornfang', 0, { col: 4, row: 4 });
    s = applyAction(s, { t: 'Move', unit: body.id, to: { col: 4, row: 5 } });
    expect(s.units[body.id]!.movedThisTurn).toBe(true);
    s = endUntil(s, 1); // ...survives the opponent's turn (that is the whole point of the fix)
    expect(s.units[body.id]!.movedThisTurn).toBe(true);
    s = endUntil(s, 0); // ...and clears only when its OWN turn comes round again
    expect(s.units[body.id]!.movedThisTurn).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Fix 5 — the static assertion
// ---------------------------------------------------------------------------

describe('validateLeader', () => {
  const everyRegisteredLeader: LeaderDef[] = [
    ...DECKS.map((d) => d.leader),
    ...DEFENSE_DECKS.map((d) => d.leader),
    BRIAR, OSKAR, KAELEN,
  ];

  it('every registered leader has only rules that can actually fire', () => {
    for (const leader of everyRegisteredLeader) {
      expect(validateLeader(leader), `${leader.id}: ${validateLeader(leader).join('; ')}`).toEqual([]);
    }
  });

  it('rejects a trigger with no leader dispatch site', () => {
    // OnDeath: a leader is never destroyed as a piece, so this could not fire in principle.
    const v = validateLeader(leaderWith([
      { trigger: 'OnDeath', effect: { e: 'Draw', n: 1 }, target: { t: 'Self' } },
    ]));
    expect(v).toHaveLength(1);
    expect(v[0]).toMatch(/OnDeath.*never fire/);
  });

  it('rejects a leader aura on a target leaderAuraApplies cannot resolve', () => {
    // `Self` and `AdjacentFriendlies` became legal in phase 3 (2026-08-05) — a leader may now buff
    // itself or its neighbours. Everything else still returns false there, so the aura would
    // never land; AdjacentEnemies is the check that an aura cannot target the OPPONENT's units.
    const v = validateLeader(leaderWith([
      { trigger: 'Passive', effect: { e: 'AuraAtk', amount: 10 }, target: { t: 'AdjacentEnemies' } },
    ]));
    expect(v).toHaveLength(1);
    expect(v[0]).toMatch(/never apply/);
  });

  it('rejects an attacker-side condition on a DEF aura', () => {
    const v = validateLeader(leaderWith([{
      trigger: 'Passive',
      effect: { e: 'AuraDef', amount: 10 },
      target: { t: 'FriendlyOfTypes', types: ['Beast'] },
      condition: { k: 'DefenderIsMarked' },
    }]));
    expect(v).toHaveLength(1);
    expect(v[0]).toMatch(/no meaning on a DEF aura/);
  });

  it('rejects an aura effect on a non-Passive trigger', () => {
    const v = validateLeader(leaderWith([
      { trigger: 'StartOfTurn', effect: { e: 'AuraAtk', amount: 10 }, target: { t: 'FriendlyOfTypes', types: ['Beast'] } },
    ]));
    expect(v).toHaveLength(1);
    expect(v[0]).toMatch(/Passive-only/);
  });

  it('accepts the shapes the engine really dispatches', () => {
    expect(validateLeader(leaderWith([
      { trigger: 'OnKill', effect: { e: 'GainSP', n: 1 }, target: { t: 'Self' } },
      { trigger: 'OnSummon', effect: { e: 'GrantMove', tiles: 1 }, target: { t: 'TriggeringUnit' } },
      { trigger: 'OnCapture', effect: { e: 'Draw', n: 1 }, target: { t: 'Self' } },
      { trigger: 'OnMove', effect: { e: 'PaintTerrain', terrain: 'Forest' }, target: { t: 'TilesMovedThrough' } },
      { trigger: 'StartOfTurn', effect: { e: 'GainSP', n: 1 }, target: { t: 'Self' } },
      {
        trigger: 'Passive',
        effect: { e: 'AuraDef', amount: 10 },
        target: { t: 'FriendlyOfTypesOnTerrain', types: ['Terra'], terrain: 'Mountain' },
        condition: { k: 'NoAdjacentEnemy' },
      },
    ]))).toEqual([]);
  });
});
