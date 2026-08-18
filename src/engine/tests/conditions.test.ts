// Phase 3 of the card-vocabulary expansion: the consolidated condition evaluator, the new
// conditions, and the new engine-resolved targets.
//
// Lands INERT — no registered card uses any of it. Each test is mutation-verified: zeroing the
// predicate or dropping its ctx wiring fails it.
//
// The consolidation is the point of the phase. Conditions used to be interpreted in FOUR places
// that disagreed, and the leader ATK aura loop was an open-coded `if`-chain with no exhaustiveness
// check — so any condition it didn't name silently meant "no condition at all".

import { describe, expect, it } from 'vitest';
import { makeBoard } from '../board';
import { conditionHolds, effectiveAtk, effectiveDef } from '../stats';
import { applyAction, debugSpawn, initGame } from '../engine';
import { validateCardRules, validateLeader } from '../content/decks';
import { OSKAR, POC_CARDS, POC_TOKENS } from '../content/poc';
import { RULES } from '../rules';
import { teleport } from './helpers';
import type { CardDef, Condition, GameState, LeaderDef, Rule, Unit } from '../types';

const BLANK: CardDef = {
  kind: 'unit', id: 'blank', name: 'Blank', type: 'Beast',
  level: 1, atk: 20, def: 20, dc: 1, keywords: [], rules: [],
};
const NO_ABILITY = { id: 'noop', name: 'No-op', cost: 99, located: false, effects: [] };

const leaderWith = (rules: Rule[], id = 'probe'): LeaderDef =>
  ({ id, name: id, type: 'Warrior', atk: 30, rules, ability: NO_ABILITY });

function game(cards: Record<string, CardDef> = {}, leaders?: [LeaderDef, LeaderDef]): GameState {
  const deck = Array.from({ length: 40 }, () => 'blank');
  return initGame({
    board: makeBoard(),
    cardDefs: { ...POC_CARDS, blank: BLANK, ...cards },
    tokenDefs: POC_TOKENS,
    players: [
      { leader: leaders?.[0] ?? leaderWith([], 'l0'), deck, fusionPool: [] },
      { leader: leaders?.[1] ?? OSKAR, deck: [...deck], fusionPool: [] },
    ],
  });
}

/** Ask the evaluator directly — the unit-level view of a condition. */
const holds = (s: GameState, cond: Condition, subject: Unit, owner: 0 | 1 = 0): boolean =>
  conditionHolds(s, cond, { subject, owner });

// ---------------------------------------------------------------------------
// Position / board
// ---------------------------------------------------------------------------

describe('NearLeader', () => {
  it('uses Chebyshev, so DIAGONAL counts — the same 8 tiles as the summon zone', () => {
    const s = game();
    const lead = s.units['leader0']!.pos;
    const u = debugSpawn(s, 'blank', 0, { col: lead.col + 1, row: lead.row + 1 }); // diagonal
    expect(holds(s, { k: 'NearLeader', tiles: 1 }, u)).toBe(true);
  });

  it('denies at 2 tiles when the radius is 1, and allows once widened', () => {
    const s = game();
    const lead = s.units['leader0']!.pos;
    const u = debugSpawn(s, 'blank', 0, { col: lead.col + 2, row: lead.row });
    expect(holds(s, { k: 'NearLeader', tiles: 1 }, u)).toBe(false);
    expect(holds(s, { k: 'NearLeader', tiles: 2 }, u)).toBe(true);
  });

  it('reads the unit\'s OWN leader, not whichever is closer', () => {
    const s = game();
    const theirs = debugSpawn(s, 'blank', 1, { col: 4, row: 2 }); // hugging P0's leader at (4,1)
    expect(holds(s, { k: 'NearLeader', tiles: 1 }, theirs, 1)).toBe(false);
  });
});

describe('OnFavoredTerrain', () => {
  it('reads the locked type-vs-terrain chart', () => {
    const s = game();
    const beast = debugSpawn(s, 'blank', 0, { col: 4, row: 4 }); // Beast favors Forest
    s.board[3]![3]!.terrain = 'Forest';
    expect(holds(s, { k: 'OnFavoredTerrain' }, beast)).toBe(true);
    s.board[3]![3]!.terrain = 'Desert'; // Beast's WEAK terrain
    expect(holds(s, { k: 'OnFavoredTerrain' }, beast)).toBe(false);
  });
});

describe('InEnemyHalf', () => {
  const inHalf = (s: GameState, u: Unit, owner: 0 | 1) => holds(s, { k: 'InEnemyHalf' }, u, owner);

  it('row 4 is NEUTRAL for both sides — it carries the springs', () => {
    const s = game();
    const mine = debugSpawn(s, 'blank', 0, { col: 4, row: 4 });
    const theirs = debugSpawn(s, 'blank', 1, { col: 5, row: 4 });
    expect(inHalf(s, mine, 0)).toBe(false);
    expect(inHalf(s, theirs, 1)).toBe(false);
  });

  it('is mirrored: rows 5-7 are enemy ground for P0, rows 1-3 for P1', () => {
    const s = game();
    const mine = debugSpawn(s, 'blank', 0, { col: 4, row: 5 });
    const theirs = debugSpawn(s, 'blank', 1, { col: 5, row: 3 });
    expect(inHalf(s, mine, 0)).toBe(true);
    expect(inHalf(s, theirs, 1)).toBe(true);
    // ...and their own half is not.
    const home = debugSpawn(s, 'blank', 0, { col: 2, row: 2 });
    expect(inHalf(s, home, 0)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// State / economy
// ---------------------------------------------------------------------------

describe('spring conditions', () => {
  const SPRING = { col: 2, row: 4 }; // makeBoard seeds (2,4) and (6,4)

  it('HoldsSpring counts ANY friendly unit; LeaderOnSpring wants the leader itself', () => {
    const s = game();
    const u = debugSpawn(s, 'blank', 0, SPRING);
    expect(conditionHolds(s, { k: 'HoldsSpring' }, { owner: 0 })).toBe(true);
    expect(conditionHolds(s, { k: 'LeaderOnSpring' }, { owner: 0 })).toBe(false);

    // Swap the body out for the leader.
    delete s.units[u.id];
    s.board[SPRING.col - 1]![SPRING.row - 1]!.occupant = undefined;
    teleport(s, 'leader0', SPRING);
    expect(conditionHolds(s, { k: 'LeaderOnSpring' }, { owner: 0 })).toBe(true);
  });

  it('an ENEMY on the spring satisfies neither', () => {
    const s = game();
    debugSpawn(s, 'blank', 1, SPRING);
    expect(conditionHolds(s, { k: 'HoldsSpring' }, { owner: 0 })).toBe(false);
    expect(conditionHolds(s, { k: 'LeaderOnSpring' }, { owner: 0 })).toBe(false);
  });
});

describe('LeaderBelowHalfPool', () => {
  it('flips exactly at half of RULES.startingLife', () => {
    const s = game();
    const half = RULES.startingLife / 2;
    s.players[0].leaderLife = half;
    expect(conditionHolds(s, { k: 'LeaderBelowHalfPool' }, { owner: 0 })).toBe(false); // not BELOW
    s.players[0].leaderLife = half - 1;
    expect(conditionHolds(s, { k: 'LeaderBelowHalfPool' }, { owner: 0 })).toBe(true);
  });
});

describe('GraveyardCountAtLeast', () => {
  it('counts only units of the named type, in the OWNER\'s graveyard', () => {
    const s = game();
    const cond: Condition = { k: 'GraveyardCountAtLeast', type: 'Beast', count: 2 };
    expect(conditionHolds(s, cond, { owner: 0 })).toBe(false);
    s.players[0].graveyard.push('blank', 'blank'); // blank is a Beast
    expect(conditionHolds(s, cond, { owner: 0 })).toBe(true);
    expect(conditionHolds(s, cond, { owner: 1 })).toBe(false); // theirs is still empty
  });
});

// ---------------------------------------------------------------------------
// Generic unit predicates
// ---------------------------------------------------------------------------

describe('unit predicates', () => {
  it('IsType / LevelAtLeast / HasKeyword / EffAtkAtLeast read the subject', () => {
    const s = game({
      big: { ...BLANK, id: 'big', name: 'big', type: 'Dragon', level: 5, atk: 50, keywords: ['Ranged'] } as CardDef,
    });
    const u = debugSpawn(s, 'big', 0, { col: 4, row: 4 });
    s.board[3]![3]!.terrain = 'Normal'; // no terrain skew

    expect(holds(s, { k: 'IsType', types: ['Dragon'] }, u)).toBe(true);
    expect(holds(s, { k: 'IsType', types: ['Beast', 'Insect'] }, u)).toBe(false);
    expect(holds(s, { k: 'LevelAtLeast', amount: 5 }, u)).toBe(true);
    expect(holds(s, { k: 'LevelAtLeast', amount: 6 }, u)).toBe(false);
    expect(holds(s, { k: 'HasKeyword', keyword: 'Ranged' }, u)).toBe(true);
    expect(holds(s, { k: 'HasKeyword', keyword: 'Frenzy' }, u)).toBe(false);
    expect(holds(s, { k: 'EffAtkAtLeast', amount: 50 }, u)).toBe(true);
    expect(holds(s, { k: 'EffAtkAtLeast', amount: 51 }, u)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The consolidation invariants
// ---------------------------------------------------------------------------

describe('consolidated evaluator invariants', () => {
  it('missing context DENIES rather than allowing', () => {
    const s = game();
    // Subject-reading predicates with no subject.
    expect(conditionHolds(s, { k: 'IsType', types: ['Beast'] }, {})).toBe(false);
    expect(conditionHolds(s, { k: 'NoAdjacentEnemy' }, {})).toBe(false);
    // Owner-reading predicates with no owner.
    expect(conditionHolds(s, { k: 'HoldsSpring' }, {})).toBe(false);
    expect(conditionHolds(s, { k: 'LeaderBelowHalfPool' }, {})).toBe(false);
    // Combat predicates outside combat.
    const u = debugSpawn(s, 'blank', 0, { col: 4, row: 4 });
    expect(holds(s, { k: 'DefenderIsMarked' }, u)).toBe(false);
    expect(holds(s, { k: 'DefenderUnmovedThisTurn' }, u)).toBe(false);
  });

  it('an ATK-reading condition denies inside an ATK computation (the recursion guard)', () => {
    const s = game();
    const u = debugSpawn(s, 'blank', 0, { col: 4, row: 4 });
    expect(conditionHolds(s, { k: 'EffAtkAtMost', amount: 999 }, { subject: u })).toBe(true);
    expect(conditionHolds(s, { k: 'EffAtkAtMost', amount: 999 }, { subject: u, insideAtk: true })).toBe(false);
    expect(conditionHolds(s, { k: 'EffAtkAtLeast', amount: 0 }, { subject: u, insideAtk: true })).toBe(false);
  });

  it('a DEF aura MAY read effective ATK — no cycle in that direction', () => {
    const armour = leaderWith([{
      trigger: 'Passive', effect: { e: 'AuraDef', amount: 30 },
      target: { t: 'FriendlyOfTypes', types: ['Beast'] },
      condition: { k: 'EffAtkAtMost', amount: 25 },
    }]);
    const s = game({}, [armour, OSKAR]);
    const small = debugSpawn(s, 'blank', 0, { col: 4, row: 4 }); // ATK 20
    s.board[3]![3]!.terrain = 'Normal';
    expect(effectiveDef(s, small)).toBe(50); // 20 base + 30: armour the small things
    small.baseAtk = 40;
    expect(effectiveDef(s, small)).toBe(20); // now too big to qualify
  });
});

// ---------------------------------------------------------------------------
// Leader aura shapes — the passives-report unblock
// ---------------------------------------------------------------------------

describe('leader aura targets', () => {
  it('Self lets a leader buff ITSELF, and nobody else', () => {
    const vain = leaderWith([{
      trigger: 'Passive', effect: { e: 'AuraAtk', amount: 15 }, target: { t: 'Self' },
    }]);
    const s = game({}, [vain, OSKAR]);
    const lead = s.units['leader0']!;
    const ally = debugSpawn(s, 'blank', 0, { col: 2, row: 2 });
    s.board[lead.pos.col - 1]![lead.pos.row - 1]!.terrain = 'Normal';
    s.board[1]![1]!.terrain = 'Normal';
    expect(effectiveAtk(s, lead)).toBe(30 + 15);
    expect(effectiveAtk(s, ally)).toBe(20); // untouched
  });

  it('AdjacentFriendlies makes the leader\'s POSITION the passive', () => {
    const banner = leaderWith([{
      trigger: 'Passive', effect: { e: 'AuraAtk', amount: 10 }, target: { t: 'AdjacentFriendlies' },
    }]);
    const s = game({}, [banner, OSKAR]);
    const lead = s.units['leader0']!.pos;
    const near = debugSpawn(s, 'blank', 0, { col: lead.col, row: lead.row + 1 }); // orthogonal
    const far = debugSpawn(s, 'blank', 0, { col: lead.col + 3, row: lead.row + 3 });
    for (const u of [near, far]) s.board[u.pos.col - 1]![u.pos.row - 1]!.terrain = 'Normal';
    expect(effectiveAtk(s, near)).toBe(30);
    expect(effectiveAtk(s, far)).toBe(20);
  });

  it('the aura follows the leader as it moves', () => {
    const banner = leaderWith([{
      trigger: 'Passive', effect: { e: 'AuraAtk', amount: 10 }, target: { t: 'AdjacentFriendlies' },
    }]);
    const s = game({}, [banner, OSKAR]);
    const u = debugSpawn(s, 'blank', 0, { col: 1, row: 5 });
    s.board[0]![4]!.terrain = 'Normal';
    expect(effectiveAtk(s, u)).toBe(20);
    teleport(s, 'leader0', { col: 1, row: 4 }); // now orthogonally adjacent
    expect(effectiveAtk(s, u)).toBe(30);
  });
});

// ---------------------------------------------------------------------------
// New engine-resolved targets
// ---------------------------------------------------------------------------

describe('new targets', () => {
  /** A global spell carrying one effect line, so the target resolution is the only variable. */
  const spell = (id: string, line: CardDef extends never ? never : Rule): CardDef => ({
    kind: 'spell', id, name: id, dc: 1, sp: 0, scope: 'global',
    effects: [{ effect: line.effect, target: line.target }],
  });

  const damageTo = (id: string, target: Rule['target']): CardDef =>
    spell(id, { trigger: 'OnSummon', effect: { e: 'Damage', amount: 99 }, target });

  it('AdjacentFriendlies hits your own adjacent bodies, not the enemy\'s', () => {
    const s = game({ nuke: damageTo('nuke', { t: 'AdjacentFriendlies' }) });
    const lead = s.units['leader0']!.pos;
    const mine = debugSpawn(s, 'blank', 0, { col: lead.col, row: lead.row + 1 });
    const theirs = debugSpawn(s, 'blank', 1, { col: lead.col + 1, row: lead.row });
    s.players[0].hand.push('nuke');
    const after = applyAction(s, { t: 'CastSpell', card: 'nuke' });
    expect(after.units[mine.id]).toBeUndefined();
    expect(after.units[theirs.id]).toBeDefined();
  });

  it('EnemiesOfTypes hits only enemies of the named types', () => {
    const s = game({ nuke: damageTo('nuke', { t: 'EnemiesOfTypes', types: ['Beast'] }) });
    const theirBeast = debugSpawn(s, 'blank', 1, { col: 5, row: 5 });
    const myBeast = debugSpawn(s, 'blank', 0, { col: 2, row: 2 });
    s.players[0].hand.push('nuke');
    const after = applyAction(s, { t: 'CastSpell', card: 'nuke' });
    expect(after.units[theirBeast.id]).toBeUndefined();
    expect(after.units[myBeast.id]).toBeDefined();
  });

  it('AllUnitsOnTerrain hits BOTH sides — a kill-zone catches its maker too', () => {
    const s = game({ nuke: damageTo('nuke', { t: 'AllUnitsOnTerrain', terrain: 'Sea' }) });
    const mine = debugSpawn(s, 'blank', 0, { col: 2, row: 2 });
    const theirs = debugSpawn(s, 'blank', 1, { col: 5, row: 5 });
    const dry = debugSpawn(s, 'blank', 0, { col: 3, row: 3 });
    s.board[1]![1]!.terrain = 'Sea';
    s.board[4]![4]!.terrain = 'Sea';
    s.board[2]![2]!.terrain = 'Normal';
    s.players[0].hand.push('nuke');
    const after = applyAction(s, { t: 'CastSpell', card: 'nuke' });
    expect(after.units[mine.id]).toBeUndefined();
    expect(after.units[theirs.id]).toBeUndefined();
    expect(after.units[dry.id]).toBeDefined();
  });

  it('TilesAroundLeader resolves the summon zone as a tile target', () => {
    const s = game({
      paver: spell('paver', {
        trigger: 'OnSummon', effect: { e: 'PaintTerrain', terrain: 'Sea' }, target: { t: 'TilesAroundLeader' },
      }),
    });
    const lead = s.units['leader0']!.pos;
    s.players[0].hand.push('paver');
    const after = applyAction(s, { t: 'CastSpell', card: 'paver' });
    expect(after.board[lead.col - 1]![lead.row]!.terrain).toBe('Sea'); // one tile up
    expect(after.board[lead.col - 1]![lead.row - 1]!.terrain).not.toBe('Sea'); // not the leader's own
  });
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe('validation', () => {
  it('rejects an ATK-reading condition on an ATK aura (the recursion guard)', () => {
    const bad = leaderWith([{
      trigger: 'Passive', effect: { e: 'AuraAtk', amount: 10 },
      target: { t: 'FriendlyOfTypes', types: ['Beast'] },
      condition: { k: 'EffAtkAtMost', amount: 20 },
    }]);
    expect(validateLeader(bad).join(' ')).toMatch(/cannot gate an ATK aura/);
  });

  it('allows the same condition on a DEF aura', () => {
    const ok = leaderWith([{
      trigger: 'Passive', effect: { e: 'AuraDef', amount: 10 },
      target: { t: 'FriendlyOfTypes', types: ['Beast'] },
      condition: { k: 'EffAtkAtMost', amount: 20 },
    }]);
    expect(validateLeader(ok)).toEqual([]);
  });

  it('rejects when.triggerUnit on a trigger that binds no unit', () => {
    const bad: CardDef = {
      ...BLANK, id: 'bad',
      rules: [{
        trigger: 'OnTerrainPainted', effect: { e: 'GainSP', n: 1 }, target: { t: 'Self' },
        when: { triggerUnit: { k: 'IsType', types: ['Dragon'] } },
      }],
    };
    expect(validateCardRules(bad).join(' ')).toMatch(/carries no triggering unit/);
  });

  it('accepts the new leader aura shapes', () => {
    expect(validateLeader(leaderWith([
      { trigger: 'Passive', effect: { e: 'AuraAtk', amount: 10 }, target: { t: 'Self' } },
      { trigger: 'Passive', effect: { e: 'AuraAtk', amount: 5 }, target: { t: 'AdjacentFriendlies' } },
    ]))).toEqual([]);
  });
});
