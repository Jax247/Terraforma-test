// Phase 0 of the crowd-control design pass (vault: Crowd Control & Status Effects).
// Three defects found by auditing CC against the vault, each verified empirically before
// being fixed:
//   1. timed statuses expired one turn early vs the locked duration rule
//   2. a Stunned unit could still make a Ranged attack, and could still change stance
//   3. forced movement never sprang zone traps (and fireTraps had no enemy-of-owner check)
import { afterEach, describe, expect, it } from 'vitest';
import { applyAction, debugSpawn, DENIAL_STATUSES, isStunned, legalActions } from '../engine';
import { effectiveAtk } from '../stats';
import { resetRules } from '../rules';
import { endUntil, freshGame, passRounds } from './helpers';
import type { CardDef, Duration, GameState, PlayerId, Unit } from '../types';

const CARDS: Record<string, CardDef> = {
  archer: {
    kind: 'unit', id: 'archer', name: 'Archer', type: 'Warrior', level: 3, atk: 40, def: 20, dc: 3,
    keywords: ['Ranged'], rules: [],
  },
  dummy: {
    kind: 'unit', id: 'dummy', name: 'Dummy', type: 'Warrior', level: 2, atk: 10, def: 10, dc: 1,
    keywords: [], rules: [],
  },
  // A zone trap that marks whatever set it off, so a test can prove which side's trap fired.
  snareZone: {
    kind: 'trap', id: 'snareZone', name: 'Snare Zone', dc: 2, interrupt: 'respond',
    trigger: { t: 'zone' },
    effects: [{
      effect: { e: 'ApplyStatus', status: 'AtkMod', amount: -5, duration: { kind: 'permanent' } },
      target: { t: 'TriggeringUnit' },
    }],
  },
  pin: {
    kind: 'spell', id: 'pin', name: 'Pin', dc: 2, sp: 0, scope: 'global',
    effects: [{
      effect: { e: 'ApplyStatus', status: 'Stunned', amount: 0, duration: { kind: 'turns', turnsLeft: 2 } },
      target: { t: 'ChosenUnit' },
    }],
  },
  weaken: {
    kind: 'spell', id: 'weaken', name: 'Weaken', dc: 2, sp: 0, scope: 'global',
    effects: [{
      effect: { e: 'ApplyStatus', status: 'AtkMod', amount: -10, duration: { kind: 'turns', turnsLeft: 2 } },
      target: { t: 'ChosenUnit' },
    }],
  },
  // ChosenUnit, not ChosenEnemy — a test needs to shove its OWN unit too. A cast spell's
  // origin is the caster's LEADER tile (doCastSpell), so this pushes directly down-board.
  shove: {
    kind: 'spell', id: 'shove', name: 'Shove', dc: 2, sp: 0, scope: 'global',
    effects: [{ effect: { e: 'Push', tiles: 2 }, target: { t: 'ChosenUnit' } }],
  },
};

function fresh(): GameState {
  const s = freshGame({ extraCards: CARDS });
  s.board[3]![3]!.terrain = 'Normal';
  return s;
}

function stun(u: Unit, duration: Duration = { kind: 'permanent' }): void {
  u.statuses.push({ id: `st-${u.id}`, kind: 'Stunned', amount: 0, duration });
}

/** How many of the owner's OWN consecutive turns the stun is still live on. */
function turnsSurvived(s: GameState, unitId: string, owner: PlayerId): number {
  let cur = s;
  let n = 0;
  for (let i = 0; i < 8; i++) {
    cur = endUntil(cur, owner);
    if (!isStunned(cur.units[unitId]!)) break;
    n += 1;
    cur = applyAction(cur, { t: 'EndTurn' });
  }
  return n;
}

afterEach(() => {
  resetRules();
});

describe('Fix 1 — a status lasts exactly N of the victim own turns', () => {
  // The vault (Non-Unit Cards) locks: "'immobilized for 2 turns' always costs the victim
  // exactly 2 of its own activations." The engine used to decrement-then-drop-at-zero, which
  // retired the status at the START of the Nth turn — before the victim ever acted on it —
  // so N only ever cost N-1.
  it.each([1, 2, 3])('turnsLeft %i costs the victim that many activations', (turns) => {
    const s = fresh();
    const victim = debugSpawn(s, 'dummy', 1, { col: 4, row: 4 });
    stun(victim, { kind: 'turns', turnsLeft: turns });
    expect(turnsSurvived(s, victim.id, 1)).toBe(turns);
  });

  it('ticks on the victim own turn, not the caster turn', () => {
    let s = fresh();
    const victim = debugSpawn(s, 'dummy', 1, { col: 4, row: 4 });
    stun(victim, { kind: 'turns', turnsLeft: 1 });
    s = applyAction(s, { t: 'EndTurn' }); // a whole caster turn passes
    expect(isStunned(s.units[victim.id]!)).toBe(true);
  });

  it('permanent and endOfTurn durations are untouched by the tick', () => {
    let s = fresh();
    const perm = debugSpawn(s, 'dummy', 1, { col: 4, row: 4 });
    const eot = debugSpawn(s, 'dummy', 1, { col: 5, row: 4 });
    stun(perm);
    stun(eot, { kind: 'endOfTurn' });
    s = passRounds(s, 3);
    expect(isStunned(s.units[perm.id]!)).toBe(true);
    expect(isStunned(s.units[eot.id]!)).toBe(false); // gone at the first end of turn
  });
});

describe('Fix 2 — Stunned blocks every action, not just movement', () => {
  it('a stunned Ranged unit cannot shoot', () => {
    const s = fresh();
    const archer = debugSpawn(s, 'archer', 0, { col: 4, row: 4 });
    const target = debugSpawn(s, 'dummy', 1, { col: 4, row: 5 });
    stun(archer);
    expect(() => applyAction(s, { t: 'RangedAttack', unit: archer.id, target: target.pos }))
      .toThrow(/cannot attack/);
    expect(s.units[target.id]).toBeDefined();
  });

  it('an unstunned Ranged unit still shoots — the guard is not blanket', () => {
    const s = fresh();
    const archer = debugSpawn(s, 'archer', 0, { col: 4, row: 4 });
    const target = debugSpawn(s, 'dummy', 1, { col: 4, row: 5 });
    const after = applyAction(s, { t: 'RangedAttack', unit: archer.id, target: target.pos });
    expect(after.units[target.id]).toBeUndefined();
  });

  it('a stunned unit cannot change stance', () => {
    const s = fresh();
    const u = debugSpawn(s, 'dummy', 0, { col: 4, row: 4 });
    stun(u);
    expect(() => applyAction(s, { t: 'SetStance', unit: u.id, stance: 'defense' }))
      .toThrow(/stunned/);
  });

  it('a stunned unit cannot move', () => {
    const s = fresh();
    const u = debugSpawn(s, 'dummy', 0, { col: 4, row: 4 });
    stun(u);
    expect(() => applyAction(s, { t: 'Move', unit: u.id, to: { col: 4, row: 5 } }))
      .toThrow(/cannot move/);
  });

  it('the AI is never offered an action a stunned unit cannot take', () => {
    const s = fresh();
    const archer = debugSpawn(s, 'archer', 0, { col: 4, row: 4 });
    debugSpawn(s, 'dummy', 1, { col: 4, row: 5 });
    stun(archer);
    const forArcher = legalActions(s).filter((a) => 'unit' in a && a.unit === archer.id);
    expect(forArcher).toEqual([]);
  });
});

describe('leaders are immune to crowd control', () => {
  // Enforced at the applyStatus chokepoint, so it holds for every source rather than card by
  // card. Sigils bill leaders in LP instead (see sigil.test.ts); spells and traps simply fizzle.
  it('a stun from a trap does not stick to a leader', () => {
    let s = fresh();
    s = endUntil(s, 1);
    s.players[1].hand.push('pin');
    const leader = Object.values(s.units).find((u) => u.isLeader && u.owner === 0)!;
    s = applyAction(s, { t: 'CastSpell', card: 'pin', targets: [leader.pos] });
    expect(isStunned(s.units[leader.id]!)).toBe(false);
    expect(s.units[leader.id]!.statuses).toEqual([]);
  });

  it('the same spell still stuns an ordinary unit', () => {
    let s = fresh();
    const victim = debugSpawn(s, 'dummy', 0, { col: 4, row: 4 });
    s = endUntil(s, 1);
    s.players[1].hand.push('pin');
    s = applyAction(s, { t: 'CastSpell', card: 'pin', targets: [victim.pos] });
    expect(isStunned(s.units[victim.id]!)).toBe(true);
  });

  it('stat mods are NOT crowd control and still land on a leader', () => {
    // Deliberate: shrinking a leader's ATK is a stat change, and its ATK is load-bearing as the
    // anti-swarm rating. Only turn-denial is immune.
    let s = fresh();
    s = endUntil(s, 1);
    s.players[1].hand.push('weaken');
    const leader = Object.values(s.units).find((u) => u.isLeader && u.owner === 0)!;
    s = applyAction(s, { t: 'CastSpell', card: 'weaken', targets: [leader.pos] });
    expect(s.units[leader.id]!.statuses.some((st) => st.kind === 'AtkMod')).toBe(true);
  });
});

describe('Fix 3 — forced movement springs zone traps', () => {
  /**
   * P2 sets a zone trap at (4,6); its 9-tile zone covers (4,5). P1 then casts Shove on the
   * unit at (4,4) — the origin is P1's leader at (4,1), so it travels down-board and halts on
   * (4,5) because the set card occupies (4,6).
   */
  function shoveInto(victimOwner: PlayerId): GameState {
    let s = fresh();
    s = endUntil(s, 1);
    s.players[1].hand.push('snareZone');
    s = applyAction(s, { t: 'SetCard', card: 'snareZone', tile: { col: 4, row: 6 } });
    s = endUntil(s, 0);
    debugSpawn(s, 'dummy', victimOwner, { col: 4, row: 4 });
    s.players[0].hand.push('shove');
    return applyAction(s, { t: 'CastSpell', card: 'shove', targets: [{ col: 4, row: 4 }] });
  }

  function victimAt(s: GameState, owner: PlayerId, row: number): Unit | undefined {
    return Object.values(s.units).find((u) => u.owner === owner && !u.isLeader && u.pos.row === row);
  }

  it('shoving your OWN unit into an enemy zone trap springs it', () => {
    const s = shoveInto(0);
    expect(victimAt(s, 0, 5)).toBeDefined(); // the push landed where we think it did
    expect(s.players[1].graveyard).toContain('snareZone');
    expect(victimAt(s, 0, 5)!.statuses.some((st) => st.kind === 'AtkMod')).toBe(true);
  });

  it('shoving an enemy unit into its OWN side trap does not spring it', () => {
    // The guard this exposed: fireTraps only filtered by "trap belongs to the non-active
    // player" and never checked the MOVER was that owner's enemy. Harmless while the mover
    // was always the active player's unit; displacement broke that assumption.
    const s = shoveInto(1);
    expect(victimAt(s, 1, 5)).toBeDefined();
    expect(s.players[1].graveyard).not.toContain('snareZone');
    expect(victimAt(s, 1, 5)!.statuses).toEqual([]);
  });

  it('walking into a zone trap still springs it — the ordinary path is unchanged', () => {
    let s = fresh();
    s = endUntil(s, 1);
    s.players[1].hand.push('snareZone');
    s = applyAction(s, { t: 'SetCard', card: 'snareZone', tile: { col: 4, row: 6 } });
    s = endUntil(s, 0);
    const walker = debugSpawn(s, 'dummy', 0, { col: 4, row: 4 });
    s = applyAction(s, { t: 'Move', unit: walker.id, to: { col: 4, row: 5 } });
    expect(s.players[1].graveyard).toContain('snareZone');
  });
});

// ---------------------------------------------------------------------------
// The denial axis: Snared / Disarmed / Stunned / Suppressed
// ---------------------------------------------------------------------------

const AXIS: Record<string, CardDef> = {
  // Ranged, so a test can prove Snare's counter is "being Ranged".
  shooter: {
    kind: 'unit', id: 'shooter', name: 'Shooter', type: 'Warrior', level: 3, atk: 40, def: 20, dc: 3,
    keywords: ['Ranged'], rules: [],
  },
  // Frenzy + an OnDeath rule: two distinct things for Suppressed to switch off.
  packLeader: {
    kind: 'unit', id: 'packLeader', name: 'Pack Leader', type: 'Beast', level: 3, atk: 30, def: 20, dc: 3,
    keywords: ['Frenzy'],
    rules: [{ trigger: 'OnDeath', effect: { e: 'GainSP', n: 3 }, target: { t: 'Self' } }],
  },
  anchor: {
    kind: 'unit', id: 'anchor', name: 'Anchor', type: 'Terra', level: 3, atk: 30, def: 40, dc: 3,
    keywords: ['Anchored'], rules: [],
  },
  shoveHard: {
    kind: 'spell', id: 'shoveHard', name: 'Shove Hard', dc: 2, sp: 0, scope: 'global',
    effects: [{ effect: { e: 'Push', tiles: 2 }, target: { t: 'ChosenUnit' } }],
  },
};

function axisGame(): GameState {
  const s = freshGame({ extraCards: { ...CARDS, ...AXIS } });
  for (let c = 1; c <= 7; c++) for (let r = 1; r <= 7; r++) s.board[c - 1]![r - 1]!.terrain = 'Normal';
  return s;
}

function mark(u: Unit, kind: 'Snared' | 'Disarmed' | 'Suppressed'): void {
  u.statuses.push({ id: `${kind}-${u.id}`, kind, amount: 0, duration: { kind: 'permanent' } });
}

describe('Snared — movement denied, shooting is the way out', () => {
  it('cannot move', () => {
    const s = axisGame();
    const u = debugSpawn(s, 'dummy', 0, { col: 4, row: 4 });
    mark(u, 'Snared');
    expect(() => applyAction(s, { t: 'Move', unit: u.id, to: { col: 4, row: 5 } })).toThrow(/cannot move/);
  });

  it('cannot melee — because move IS attack, a snared melee body is fully shut down', () => {
    const s = axisGame();
    const u = debugSpawn(s, 'dummy', 0, { col: 4, row: 4 });
    debugSpawn(s, 'dummy', 1, { col: 4, row: 5 });
    mark(u, 'Snared');
    expect(() => applyAction(s, { t: 'Move', unit: u.id, to: { col: 4, row: 5 } })).toThrow(/cannot move/);
  });

  it('a snared RANGED unit still shoots — the status is designed to be answered this way', () => {
    const s = axisGame();
    const archer = debugSpawn(s, 'shooter', 0, { col: 4, row: 4 });
    const target = debugSpawn(s, 'dummy', 1, { col: 4, row: 5 });
    mark(archer, 'Snared');
    const after = applyAction(s, { t: 'RangedAttack', unit: archer.id, target: target.pos });
    expect(after.units[target.id]).toBeUndefined();
  });
});

describe('Disarmed — offence denied both ways, the legs still work', () => {
  it('may still move to an empty tile', () => {
    const s = axisGame();
    const u = debugSpawn(s, 'dummy', 0, { col: 4, row: 4 });
    mark(u, 'Disarmed');
    const after = applyAction(s, { t: 'Move', unit: u.id, to: { col: 4, row: 5 } });
    expect(after.units[u.id]!.pos).toEqual({ col: 4, row: 5 });
  });

  it('cannot initiate a melee attack', () => {
    const s = axisGame();
    const u = debugSpawn(s, 'dummy', 0, { col: 4, row: 4 });
    debugSpawn(s, 'dummy', 1, { col: 4, row: 5 });
    mark(u, 'Disarmed');
    expect(() => applyAction(s, { t: 'Move', unit: u.id, to: { col: 4, row: 5 } })).toThrow(/cannot attack/);
  });

  it('cannot shoot either — unlike Snare, this one does stop a Ranged unit', () => {
    const s = axisGame();
    const archer = debugSpawn(s, 'shooter', 0, { col: 4, row: 4 });
    const target = debugSpawn(s, 'dummy', 1, { col: 4, row: 5 });
    mark(archer, 'Disarmed');
    expect(() => applyAction(s, { t: 'RangedAttack', unit: archer.id, target: target.pos }))
      .toThrow(/cannot attack/);
  });

  it('cannot strike back either — striking back IS attacking', () => {
    // The principle: a unit denied its offence is denied it whether or not it chose the fight.
    const s = axisGame();
    const defender = debugSpawn(s, 'dummy', 1, { col: 4, row: 5 });
    mark(defender, 'Disarmed');
    const attacker = debugSpawn(s, 'dummy', 0, { col: 4, row: 4 }); // equal ATK
    const after = applyAction(s, { t: 'Move', unit: attacker.id, to: { col: 4, row: 5 } });
    expect(after.units[defender.id]).toBeUndefined();  // loses the tie
    expect(after.units[attacker.id]).toBeDefined();    // ...and takes nobody with it
  });
});

describe('Suppressed — the text goes quiet, the body does not', () => {
  it('keywords stop applying: Frenzy adds nothing', () => {
    const s = axisGame();
    const pack = debugSpawn(s, 'packLeader', 0, { col: 4, row: 4 });
    debugSpawn(s, 'dummy', 0, { col: 4, row: 5 }); // one adjacent ally = +5 Frenzy
    const buffed = effectiveAtk(s, s.units[pack.id]!);
    mark(s.units[pack.id]!, 'Suppressed');
    expect(effectiveAtk(s, s.units[pack.id]!)).toBe(buffed - 5);
  });

  it('Anchored stops refusing displacement — the Suppress-then-Push combo', () => {
    const push = (suppress: boolean) => {
      let s = axisGame();
      const wall = debugSpawn(s, 'anchor', 1, { col: 4, row: 4 });
      if (suppress) mark(wall, 'Suppressed');
      s.players[0].hand.push('shoveHard');
      s = applyAction(s, { t: 'CastSpell', card: 'shoveHard', targets: [{ col: 4, row: 4 }] });
      return s.units[wall.id]!.pos;
    };
    expect(push(false)).toEqual({ col: 4, row: 4 }); // Anchored: unmoved
    expect(push(true)).not.toEqual({ col: 4, row: 4 }); // suppressed: shoved
  });

  it('card rules stop firing: no OnDeath payout', () => {
    const sp = (suppress: boolean) => {
      const s = axisGame();
      const pack = debugSpawn(s, 'packLeader', 1, { col: 4, row: 5 });
      if (suppress) mark(pack, 'Suppressed');
      const killer = debugSpawn(s, 'archer', 0, { col: 4, row: 4 }); // 40 > 30
      const before = s.players[1].sp;
      const after = applyAction(s, { t: 'Move', unit: killer.id, to: { col: 4, row: 5 } });
      expect(after.units[pack.id]).toBeUndefined();
      return after.players[1].sp - before;
    };
    expect(sp(false)).toBe(3); // OnDeath GainSP fired
    expect(sp(true)).toBe(0);  // silenced
  });

  it('does NOT stop the unit acting — it denies text, not actions', () => {
    const s = axisGame();
    const u = debugSpawn(s, 'dummy', 0, { col: 4, row: 4 });
    mark(u, 'Suppressed');
    const after = applyAction(s, { t: 'Move', unit: u.id, to: { col: 4, row: 5 } });
    expect(after.units[u.id]!.pos).toEqual({ col: 4, row: 5 });
  });

  it('leaves the printed keyword list intact so the status can expire cleanly', () => {
    const s = axisGame();
    const pack = debugSpawn(s, 'packLeader', 0, { col: 4, row: 4 });
    mark(pack, 'Suppressed');
    expect(s.units[pack.id]!.keywords).toContain('Frenzy'); // suspended, not erased
  });
});

describe('leaders are immune to every denial status, not just Stunned', () => {
  // Routed through a real spell each time, so this proves the applyStatus chokepoint and not
  // just the set membership.
  it.each(['Stunned', 'Snared', 'Disarmed', 'Suppressed'] as const)('%s does not stick to a leader', (kind) => {
    const spell: CardDef = {
      kind: 'spell', id: 'deny', name: 'Deny', dc: 2, sp: 0, scope: 'global',
      effects: [{
        effect: { e: 'ApplyStatus', status: kind, amount: 0, duration: { kind: 'turns', turnsLeft: 2 } },
        target: { t: 'ChosenUnit' },
      }],
    };
    let s = freshGame({ extraCards: { ...CARDS, ...AXIS, deny: spell } });
    const leader = Object.values(s.units).find((u) => u.isLeader && u.owner === 1)!;
    const victim = debugSpawn(s, 'dummy', 1, { col: 4, row: 4 });
    s.players[0].hand.push('deny', 'deny');

    s = applyAction(s, { t: 'CastSpell', card: 'deny', targets: [leader.pos] });
    expect(s.units[leader.id]!.statuses).toEqual([]);

    // ...and the very same spell lands on an ordinary unit, so the test cannot pass by fizzling.
    s = applyAction(s, { t: 'CastSpell', card: 'deny', targets: [victim.pos] });
    expect(s.units[victim.id]!.statuses.map((st) => st.kind)).toEqual([kind]);
    expect(DENIAL_STATUSES.has(kind)).toBe(true);
  });
});

describe('Stunned is safe to attack — it cannot strike back', () => {
  // Unit combat has no discrete strikeback step (it is one ATK comparison), so "cannot strike
  // back" had to be GIVEN a meaning: a helpless defender never harms its attacker, and loses
  // ties. These pin down all three branches.
  const BODIES: Record<string, CardDef> = {
    small: { kind: 'unit', id: 'small', name: 'Small', type: 'Warrior', level: 2, atk: 20, def: 10, dc: 1, keywords: [], rules: [] },
    mid: { kind: 'unit', id: 'mid', name: 'Mid', type: 'Warrior', level: 3, atk: 30, def: 20, dc: 2, keywords: [], rules: [] },
    big: { kind: 'unit', id: 'big', name: 'Big', type: 'Warrior', level: 4, atk: 50, def: 30, dc: 3, keywords: [], rules: [] },
  };

  /** Attacker at (4,4) walks into a defender at (4,5). Returns the post-combat state. */
  function clash(atkCard: string, defCard: string, kind?: 'Stunned' | 'Snared' | 'Disarmed' | 'Suppressed') {
    const s = freshGame({ extraCards: { ...CARDS, ...BODIES } });
    for (let c = 1; c <= 7; c++) for (let r = 1; r <= 7; r++) s.board[c - 1]![r - 1]!.terrain = 'Normal';
    const atk = debugSpawn(s, atkCard, 0, { col: 4, row: 4 });
    const def = debugSpawn(s, defCard, 1, { col: 4, row: 5 });
    if (kind) def.statuses.push({ id: 'x', kind, amount: 0, duration: { kind: 'permanent' } });
    const lpBefore = s.players[0].leaderLife;
    const after = applyAction(s, { t: 'Move', unit: atk.id, to: { col: 4, row: 5 } });
    return { after, atk, def, lpBefore };
  }

  it('an equal-ATK trade stops being mutual destruction — the helpless body just dies', () => {
    const { after, atk, def } = clash('mid', 'mid', 'Stunned');
    expect(after.units[def.id]).toBeUndefined();
    expect(after.units[atk.id]).toBeDefined();
    expect(after.units[atk.id]!.pos).toEqual({ col: 4, row: 5 }); // advance-on-kill still applies
  });

  it('a losing attacker bounces off instead of dying, and takes no overflow', () => {
    const { after, atk, def, lpBefore } = clash('small', 'big', 'Stunned');
    expect(after.units[atk.id]).toBeDefined();          // survives
    expect(after.units[def.id]).toBeDefined();          // the stun is not a free break either
    expect(after.units[atk.id]!.pos).toEqual({ col: 4, row: 4 }); // no advance
    expect(after.players[0].leaderLife).toBe(lpBefore); // no overflow back
  });

  it('winning outright is unchanged — kill, overflow, advance', () => {
    const { after, def } = clash('big', 'mid', 'Stunned');
    expect(after.units[def.id]).toBeUndefined();
    expect(after.players[1].leaderLife).toBe(200 - 20); // 50 − 30 spills as usual
  });

  it('a Ranged attacker is equally safe', () => {
    const s = freshGame({ extraCards: { ...CARDS, ...BODIES } });
    for (let c = 1; c <= 7; c++) for (let r = 1; r <= 7; r++) s.board[c - 1]![r - 1]!.terrain = 'Normal';
    const archer = debugSpawn(s, 'archer', 0, { col: 4, row: 4 }); // 40 ATK, Ranged
    const wall = debugSpawn(s, 'big', 1, { col: 4, row: 5 });      // 50 ATK
    wall.statuses.push({ id: 'x', kind: 'Stunned', amount: 0, duration: { kind: 'permanent' } });
    const after = applyAction(s, { t: 'RangedAttack', unit: archer.id, target: wall.pos });
    expect(after.units[archer.id]).toBeDefined();
    expect(after.players[0].leaderLife).toBe(200);
  });

  it('a leader takes no strikeback chip from a helpless unit', () => {
    const s = freshGame({ extraCards: { ...CARDS, ...BODIES } });
    for (let c = 1; c <= 7; c++) for (let r = 1; r <= 7; r++) s.board[c - 1]![r - 1]!.terrain = 'Normal';
    const leader = Object.values(s.units).find((u) => u.isLeader && u.owner === 0)!;
    const wall = debugSpawn(s, 'big', 1, { col: 4, row: 2 }); // out-stats Briar
    wall.statuses.push({ id: 'x', kind: 'Stunned', amount: 0, duration: { kind: 'permanent' } });
    const after = applyAction(s, { t: 'Move', unit: leader.id, to: { col: 4, row: 2 } });
    expect(after.players[0].leaderLife).toBe(200); // no chip
    expect(after.units[wall.id]).toBeDefined();
  });

  it('CONTRAST: Snared and Suppressed bodies still punish an attacker', () => {
    // These two deny movement and text, not offence — so they keep their teeth. This is what
    // makes the axis a trade-off rather than a flat ladder: Snare pins a body in place but
    // leaves it dangerous, Disarm makes it harmless but lets it run.
    for (const kind of ['Snared', 'Suppressed'] as const) {
      const { after, atk, lpBefore } = clash('small', 'big', kind);
      expect(after.units[atk.id]).toBeUndefined();               // attacker dies
      expect(after.players[0].leaderLife).toBeLessThan(lpBefore); // and bleeds overflow
    }
  });

  it('a Disarmed body is safe to attack too, but unlike a Stunned one it can still run', () => {
    const { after, atk, def, lpBefore } = clash('small', 'big', 'Disarmed');
    expect(after.units[atk.id]).toBeDefined();          // no strikeback
    expect(after.units[def.id]).toBeDefined();          // still not a free break
    expect(after.players[0].leaderLife).toBe(lpBefore); // no overflow back
    // The escape hatch that keeps it below Stunned: its legs work.
    const fled = applyAction(after, { t: 'EndTurn' });
    expect(legalActions(fled).some((a) => a.t === 'Move' && a.unit === def.id)).toBe(true);
  });
});
