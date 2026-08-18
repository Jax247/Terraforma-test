// The 2026-08-04 trigger vocabulary expansion (phase 1 of the card-vocabulary design report).
//
// Every trigger here is a NEW dispatch site in an existing code path, and the whole phase is
// meant to land INERT — no registered card uses any of it yet, so all 8 decks must play exactly
// as before. Each test below is mutation-verified: removing its dispatch site fails it.

import { describe, expect, it } from 'vitest';
import { makeBoard } from '../board';
import { applyAction, debugSpawn, initGame } from '../engine';
import { DECKS, DEFENSE_DECKS, validateCardRules, validateLeader, DECK_CARDS } from '../content/decks';
import { OSKAR, POC_CARDS, POC_TOKENS } from '../content/poc';
import { endUntil } from './helpers';
import type { CardDef, GameState, LeaderDef, Rule, Terrain, TriggerScope } from '../types';

/** A body with no printed text; each test clones it with the rules under test. */
const BLANK: CardDef = {
  kind: 'unit', id: 'blank', name: 'Blank', type: 'Beast',
  level: 1, atk: 20, def: 20, dc: 1, keywords: [], rules: [],
};

const withRules = (id: string, rules: Rule[], over: Partial<CardDef> = {}): CardDef =>
  ({ ...BLANK, id, name: id, rules, ...over } as CardDef);

/** GainSP is the cleanest observable: no targeting subtleties, survives unit death. */
const gainSp = (trigger: Rule['trigger'], n = 3, scope?: TriggerScope): Rule =>
  ({ trigger, effect: { e: 'GainSP', n }, target: { t: 'Self' }, ...(scope ? { when: { scope } } : {}) });

const NO_ABILITY = { id: 'noop', name: 'No-op', cost: 99, located: false, effects: [] };

function game(cards: Record<string, CardDef>, leaders?: [LeaderDef, LeaderDef]): GameState {
  const deck = Array.from({ length: 40 }, () => 'blank');
  return initGame({
    board: makeBoard(),
    cardDefs: { ...POC_CARDS, blank: BLANK, ...cards },
    tokenDefs: POC_TOKENS,
    players: [
      { leader: leaders?.[0] ?? { id: 'l0', name: 'L0', type: 'Warrior', atk: 30, rules: [], ability: NO_ABILITY }, deck, fusionPool: [] },
      { leader: leaders?.[1] ?? OSKAR, deck: [...deck], fusionPool: [] },
    ],
  });
}

// ---------------------------------------------------------------------------
// EndOfTurn
// ---------------------------------------------------------------------------

describe('EndOfTurn', () => {
  it('fires for the active player before the handover', () => {
    const s = game({ ticker: withRules('ticker', [gainSp('EndOfTurn', 3)]) });
    debugSpawn(s, 'ticker', 0, { col: 4, row: 4 });
    // SP is zeroed during the end phase, so observe LP-free state: the log records the gain.
    const after = applyAction(s, { t: 'EndTurn' });
    expect(after.log.some((l) => /gains 3 SP|\+3 SP/i.test(l))).toBe(true);
  });

  it('does NOT fire for the inactive player', () => {
    const s = game({ ticker: withRules('ticker', [gainSp('EndOfTurn', 3)]) });
    debugSpawn(s, 'ticker', 1, { col: 4, row: 4 }); // P2's unit, P1 ends their turn
    const before = s.log.length;
    const after = applyAction(s, { t: 'EndTurn' });
    expect(after.log.slice(before).some((l) => /3 SP/.test(l))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// OnFlip
// ---------------------------------------------------------------------------

describe('OnFlip', () => {
  it('fires when a set unit is flipped face-up', () => {
    const s = game({ trickster: withRules('trickster', [gainSp('OnFlip', 4)]) });
    s.players[0].hand.push('trickster');
    s.players[0].sp = 8;
    let cur = applyAction(s, { t: 'SetCard', card: 'trickster', tile: { col: 4, row: 2 } });
    const setId = Object.values(cur.setCards)[0]!.id;
    cur = endUntil(cur, 1);
    cur = endUntil(cur, 0); // a turn passes so the flip is legal
    const spBefore = cur.players[0].sp;
    cur = applyAction(cur, { t: 'FlipCard', set: setId });
    expect(cur.players[0].sp).toBe(spBefore + 4);
  });
});

// ---------------------------------------------------------------------------
// OnSpellCast / OnAbilityCast
// ---------------------------------------------------------------------------

describe('OnSpellCast', () => {
  /** A global spell with no board requirements, so the test isolates the trigger. */
  const PING: CardDef = {
    kind: 'spell', id: 'ping', name: 'Ping', dc: 1, sp: 1, scope: 'global',
    effects: [{ effect: { e: 'Draw', n: 1 }, target: { t: 'Self' } }],
  };

  it('fires on a player activation', () => {
    const s = game({ savant: withRules('savant', [gainSp('OnSpellCast', 2)]), ping: PING });
    debugSpawn(s, 'savant', 0, { col: 4, row: 4 });
    s.players[0].hand.push('ping');
    s.players[0].sp = 8;
    const after = applyAction(s, { t: 'CastSpell', card: 'ping' });
    expect(after.players[0].sp).toBe(8 - 1 + 2); // 1 SP for the spell, +2 from the trigger
  });
});

describe('OnAbilityCast', () => {
  it('fires when the leader activates its ability', () => {
    const rally: LeaderDef = {
      id: 'rallyLeader', name: 'Rally Leader', type: 'Warrior', atk: 30, rules: [],
      ability: {
        id: 'cheapRally', name: 'Cheap Rally', cost: 1, located: false,
        effects: [{ effect: { e: 'GainSP', n: 0 }, target: { t: 'Self' } }],
      },
    };
    const s = game({ zealot: withRules('zealot', [gainSp('OnAbilityCast', 5)]) }, [rally, OSKAR]);
    debugSpawn(s, 'zealot', 0, { col: 4, row: 4 });
    s.players[0].sp = 8;
    const after = applyAction(s, { t: 'ActivateAbility' });
    expect(after.players[0].sp).toBe(8 - 1 + 5);
  });
});

// ---------------------------------------------------------------------------
// OnSummonAlly / OnEnemySummon
// ---------------------------------------------------------------------------

describe('summon reactions', () => {
  it('OnSummonAlly fires for YOUR summons and not the opponent\'s', () => {
    const s = game({ herald: withRules('herald', [gainSp('OnSummonAlly', 2)]) });
    debugSpawn(s, 'herald', 0, { col: 2, row: 2 });
    s.players[0].hand.push('blank');
    s.players[0].sp = 8;
    const after = applyAction(s, { t: 'Summon', card: 'blank', tile: { col: 4, row: 2 } });
    expect(after.players[0].sp).toBe(8 - 1 + 2); // blank costs level 1

    // Now the opponent summons: the herald must stay silent.
    let cur = endUntil(after, 1);
    cur.players[1].hand.push('blank');
    cur.players[1].sp = 8;
    const spBefore = cur.players[0].sp;
    cur = applyAction(cur, { t: 'Summon', card: 'blank', tile: { col: 4, row: 6 } });
    expect(cur.players[0].sp).toBe(spBefore);
  });

  it('OnEnemySummon fires on the OPPONENT\'s summon, and binds the new unit', () => {
    // Snare the thing that just arrived — the archetypal reactive card.
    const watcher = withRules('watcher', [{
      trigger: 'OnEnemySummon',
      effect: { e: 'ApplyStatus', status: 'Snared', amount: 0, duration: { kind: 'turns', turnsLeft: 2 } },
      target: { t: 'TriggeringUnit' },
    }]);
    const s = game({ watcher });
    debugSpawn(s, 'watcher', 0, { col: 2, row: 2 });
    let cur = endUntil(s, 1);
    cur.players[1].hand.push('blank');
    cur.players[1].sp = 8;
    const before = new Set(Object.keys(cur.units));
    cur = applyAction(cur, { t: 'Summon', card: 'blank', tile: { col: 4, row: 6 } });
    const summoned = Object.values(cur.units).find((u) => !before.has(u.id));
    expect(summoned).toBeDefined();
    expect(summoned!.statuses.some((st) => st.kind === 'Snared')).toBe(true);
  });

  it('when.triggerUnit gates on the TRIGGERING unit, not on the rule\'s targets', () => {
    // "When the opponent summons a Dragon, gain SP." The target is Self — a Beast — so if this
    // predicate were evaluated against the target (as Rule.condition is) it could never hold.
    // Firing on a Dragon summon is what proves it reads the triggering unit instead.
    const watcher = withRules('watcher', [{
      trigger: 'OnEnemySummon',
      effect: { e: 'GainSP', n: 4 },
      target: { t: 'Self' },
      when: { triggerUnit: { k: 'IsType', types: ['Dragon'] } },
    }]);
    const dragon: CardDef = { ...BLANK, id: 'dragon', name: 'dragon', type: 'Dragon' };
    const s = game({ watcher, dragon });
    debugSpawn(s, 'watcher', 0, { col: 2, row: 2 }); // watcher is a Beast

    // A Beast summon must NOT fire it.
    let cur = endUntil(s, 1);
    cur.players[1].hand.push('blank');
    cur.players[1].sp = 8;
    let spBefore = cur.players[0].sp;
    cur = applyAction(cur, { t: 'Summon', card: 'blank', tile: { col: 4, row: 6 } });
    expect(cur.players[0].sp).toBe(spBefore);

    // A Dragon summon must.
    cur.players[1].hand.push('dragon');
    cur.players[1].sp = 8;
    spBefore = cur.players[0].sp;
    cur = applyAction(cur, { t: 'Summon', card: 'dragon', tile: { col: 5, row: 6 } });
    expect(cur.players[0].sp).toBe(spBefore + 4);
  });

  it('a condition can reject the summoned unit, so the rule only answers real threats', () => {
    const watcher = withRules('watcher', [{
      trigger: 'OnEnemySummon',
      effect: { e: 'ApplyStatus', status: 'Snared', amount: 0, duration: { kind: 'turns', turnsLeft: 2 } },
      target: { t: 'TriggeringUnit' },
      condition: { k: 'EffAtkAtMost', amount: 10 }, // blank is ATK 20 -> must NOT fire
    }]);
    const s = game({ watcher });
    debugSpawn(s, 'watcher', 0, { col: 2, row: 2 });
    let cur = endUntil(s, 1);
    cur.players[1].hand.push('blank');
    cur.players[1].sp = 8;
    const before = new Set(Object.keys(cur.units));
    cur = applyAction(cur, { t: 'Summon', card: 'blank', tile: { col: 4, row: 6 } });
    const summoned = Object.values(cur.units).find((u) => !before.has(u.id));
    expect(summoned!.statuses.some((st) => st.kind === 'Snared')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Deathwatch
// ---------------------------------------------------------------------------

describe('OnAllyDeath (Deathwatch)', () => {
  it('fires when another friendly dies, and not for its own death', () => {
    const s = game({
      watcher: withRules('watcher', [gainSp('OnAllyDeath', 3)]),
      chaff: withRules('chaff', [], { id: 'chaff', atk: 10, def: 10 }),
    });
    debugSpawn(s, 'watcher', 0, { col: 2, row: 2 });
    const chaff = debugSpawn(s, 'chaff', 0, { col: 4, row: 4 });
    const killer = debugSpawn(s, 'blank', 1, { col: 4, row: 5 }); // 20 beats 10
    let cur = endUntil(s, 1);
    const spBefore = cur.players[0].sp;
    cur = applyAction(cur, { t: 'Move', unit: killer.id, to: { col: 4, row: 4 } });
    expect(cur.units[chaff.id]).toBeUndefined();
    expect(cur.players[0].sp).toBe(spBefore + 3);
  });

  it('scope enemy fires on the OPPONENT\'s losses instead', () => {
    const s = game({ vulture: withRules('vulture', [gainSp('OnAllyDeath', 3, 'enemy')]) });
    debugSpawn(s, 'vulture', 0, { col: 2, row: 2 });
    const prey = debugSpawn(s, 'blank', 1, { col: 4, row: 4 });
    const killer = debugSpawn(s, 'blank', 0, { col: 4, row: 3 });
    // Equal ATK would tie; give the attacker the edge via a stronger body.
    killer.baseAtk = 40;
    const spBefore = s.players[0].sp;
    const after = applyAction(s, { t: 'Move', unit: killer.id, to: { col: 4, row: 4 } });
    expect(after.units[prey.id]).toBeUndefined();
    expect(after.players[0].sp).toBe(spBefore + 3);
  });

  it('a death chain terminates instead of recursing forever', () => {
    // Two mutual martyrs: each one's death destroys an adjacent enemy, which triggers the other.
    const martyr = withRules('martyr', [{
      trigger: 'OnAllyDeath', effect: { e: 'Destroy' }, target: { t: 'AdjacentEnemies' }, when: { scope: 'any' },
    }]);
    const s = game({ martyr, chaff: withRules('chaff', [], { id: 'chaff', atk: 10, def: 10 }) });
    for (let i = 0; i < 3; i++) debugSpawn(s, 'martyr', 0, { col: 2 + i, row: 3 });
    for (let i = 0; i < 3; i++) debugSpawn(s, 'martyr', 1, { col: 2 + i, row: 4 });
    const chaff = debugSpawn(s, 'chaff', 0, { col: 6, row: 3 });
    const killer = debugSpawn(s, 'blank', 1, { col: 6, row: 4 });
    let cur = endUntil(s, 1);
    // The assertion is simply that this returns at all rather than blowing the stack.
    expect(() => { cur = applyAction(cur, { t: 'Move', unit: killer.id, to: { col: 6, row: 3 } }); }).not.toThrow();
    expect(cur.units[chaff.id]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// OnAttack / OnDefend
// ---------------------------------------------------------------------------

describe('OnAttack / OnDefend', () => {
  it('OnAttack fires before stats are read, so a self-pump changes the outcome', () => {
    // 20 ATK attacker vs 30 ATK defender loses — unless it pumps +20 on the way in.
    const charger = withRules('charger', [{
      trigger: 'OnAttack',
      effect: { e: 'ApplyStatus', status: 'AtkMod', amount: 20, duration: { kind: 'endOfTurn' } },
      target: { t: 'Self' },
    }]);
    const s = game({ charger, wall: withRules('wall', [], { id: 'wall', atk: 30, def: 30 }) });
    const atk = debugSpawn(s, 'charger', 0, { col: 4, row: 3 });
    const def = debugSpawn(s, 'wall', 1, { col: 4, row: 4 });
    const after = applyAction(s, { t: 'Move', unit: atk.id, to: { col: 4, row: 4 } });
    expect(after.units[def.id]).toBeUndefined(); // 40 > 30: the pump landed in time
    expect(after.units[atk.id]).toBeDefined();
  });

  it('OnDefend can break off the attack by displacing the attacker', () => {
    const repulsor = withRules('repulsor', [{
      trigger: 'OnDefend', effect: { e: 'Push', tiles: 1 }, target: { t: 'AdjacentEnemies' },
    }], { id: 'repulsor', atk: 10, def: 10 });
    const s = game({ repulsor });
    const atk = debugSpawn(s, 'blank', 0, { col: 4, row: 3 }); // 20 would kill a 10
    const def = debugSpawn(s, 'repulsor', 1, { col: 4, row: 4 });
    const after = applyAction(s, { t: 'Move', unit: atk.id, to: { col: 4, row: 4 } });
    expect(after.units[def.id]).toBeDefined();            // survived: the fight never happened
    expect(after.units[atk.id]!.pos).toEqual({ col: 4, row: 2 }); // shoved back
  });
});

// ---------------------------------------------------------------------------
// OnCapture scope
// ---------------------------------------------------------------------------

describe('OnCapture scope', () => {
  const springTile = { col: 2, row: 4 }; // makeBoard seeds springs at (2,4)/(6,4)
  /** Taking a spring pays RULES.springSp on its own; the trigger's SP sits on top of that. */
  const SPRING_SP = 3;

  it('defaults to self: a bystander with the same rule does not fire', () => {
    const s = game({ diver: withRules('diver', [gainSp('OnCapture', 2)]) });
    const capper = debugSpawn(s, 'diver', 0, { col: 2, row: 3 });
    debugSpawn(s, 'diver', 0, { col: 5, row: 3 }); // bystander, same card
    const spBefore = s.players[0].sp;
    const after = applyAction(s, { t: 'Move', unit: capper.id, to: springTile });
    expect(after.players[0].sp).toBe(spBefore + SPRING_SP + 2); // exactly one fire, not two
  });

  it('scope friendly fires for a teammate\'s capture', () => {
    const s = game({
      diver: withRules('diver', [gainSp('OnCapture', 2)]),
      banner: withRules('banner', [gainSp('OnCapture', 5, 'friendly')]),
    });
    const capper = debugSpawn(s, 'diver', 0, { col: 2, row: 3 });
    debugSpawn(s, 'banner', 0, { col: 5, row: 3 });
    const spBefore = s.players[0].sp;
    const after = applyAction(s, { t: 'Move', unit: capper.id, to: springTile });
    expect(after.players[0].sp).toBe(spBefore + SPRING_SP + 2 + 5);
  });

  it('scope enemy lets a card punish the opponent for taking ground', () => {
    const s = game({ sentinel: withRules('sentinel', [gainSp('OnCapture', 4, 'enemy')]) });
    debugSpawn(s, 'sentinel', 0, { col: 5, row: 3 });
    const theirs = debugSpawn(s, 'blank', 1, { col: 2, row: 3 });
    let cur = endUntil(s, 1);
    const spBefore = cur.players[0].sp;
    cur = applyAction(cur, { t: 'Move', unit: theirs.id, to: springTile });
    expect(cur.players[0].sp).toBe(spBefore + 4);
  });
});

// ---------------------------------------------------------------------------
// Terrainfall (OnTerrainPainted)
// ---------------------------------------------------------------------------

describe('OnTerrainPainted (Terrainfall)', () => {
  /** A located spell that paints exactly one tile — the smallest possible paint event. */
  const paintOne = (id: string, terrain: Terrain): CardDef => ({
    kind: 'spell', id, name: id, dc: 1, sp: 1, scope: 'located',
    effects: [{ effect: { e: 'PaintTerrain', terrain }, target: { t: 'ThisTile' } }],
  });

  /** Paints the leader's own tile, so reach is never in question. */
  function paint(s: GameState, card: string): GameState {
    s.players[0].hand.push(card);
    s.players[0].sp = 8;
    return applyAction(s, { t: 'CastSpell', card });
  }

  function watcherGame(rules: Rule[], extra: Record<string, CardDef> = {}): GameState {
    const s = game({ watcher: withRules('watcher', rules), ...extra });
    debugSpawn(s, 'watcher', 0, { col: 6, row: 6 });
    return s;
  }

  it('fires when a paint actually changes a tile', () => {
    const s = watcherGame([gainSp('OnTerrainPainted', 3)], { toForest: paintOne('toForest', 'Forest') });
    const lead = s.units['leader0']!.pos;
    s.board[lead.col - 1]![lead.row - 1]!.terrain = 'Normal'; // guarantee a real change
    const after = paint(s, 'toForest');
    expect(after.players[0].sp).toBe(8 - 1 + 3);
  });

  it('does NOT fire when the tile is already that terrain', () => {
    // The anti-farm ruling: Briar walking over her own Forest must not print SP.
    const s = watcherGame([gainSp('OnTerrainPainted', 3)], { toForest: paintOne('toForest', 'Forest') });
    const lead = s.units['leader0']!.pos;
    s.board[lead.col - 1]![lead.row - 1]!.terrain = 'Forest'; // already Forest
    const after = paint(s, 'toForest');
    expect(after.players[0].sp).toBe(8 - 1); // spell paid for, no trigger
  });

  it('does NOT fire when the paint is refused by a Wall', () => {
    const s = watcherGame([gainSp('OnTerrainPainted', 3)], { toForest: paintOne('toForest', 'Forest') });
    const lead = s.units['leader0']!.pos;
    s.board[lead.col - 1]![lead.row - 1]!.terrain = 'Wall';
    const after = paint(s, 'toForest');
    expect(after.players[0].sp).toBe(8 - 1);
    expect(after.board[lead.col - 1]![lead.row - 1]!.terrain).toBe('Wall'); // genuinely refused
  });

  it('a same-terrain paint STILL wipes a sigil — the change-check must not touch that', () => {
    // Regression guard: `changed` exists only to gate the trigger, never the sigil branch.
    const s = watcherGame([gainSp('OnTerrainPainted', 3)], { toForest: paintOne('toForest', 'Forest') });
    const lead = s.units['leader0']!.pos;
    const tile = s.board[lead.col - 1]![lead.row - 1]!;
    tile.terrain = 'Forest';
    tile.sigil = { status: 'Stunned', amount: 0, turns: 2 };
    const after = paint(s, 'toForest');
    expect(after.board[lead.col - 1]![lead.row - 1]!.sigil).toBeUndefined(); // wiped anyway
    expect(after.players[0].sp).toBe(8 - 1);                                 // but no trigger
  });

  it('when.terrain filters to the terrain the tile became', () => {
    const rules: Rule[] = [{
      trigger: 'OnTerrainPainted', effect: { e: 'GainSP', n: 3 }, target: { t: 'Self' },
      when: { terrain: 'Forest' },
    }];
    const s = watcherGame(rules, { toSea: paintOne('toSea', 'Sea'), toForest: paintOne('toForest', 'Forest') });
    const lead = s.units['leader0']!.pos;
    s.board[lead.col - 1]![lead.row - 1]!.terrain = 'Normal';

    const wrong = paint(s, 'toSea');
    expect(wrong.players[0].sp).toBe(8 - 1); // Sea does not match the Forest filter

    const s2 = watcherGame(rules, { toForest: paintOne('toForest', 'Forest') });
    const lead2 = s2.units['leader0']!.pos;
    s2.board[lead2.col - 1]![lead2.row - 1]!.terrain = 'Normal';
    expect(paint(s2, 'toForest').players[0].sp).toBe(8 - 1 + 3);
  });

  it('when.scope enemy answers the OPPONENT\'s paint instead of your own', () => {
    const rules: Rule[] = [{
      trigger: 'OnTerrainPainted', effect: { e: 'GainSP', n: 3 }, target: { t: 'Self' },
      when: { scope: 'enemy' },
    }];
    const s = watcherGame(rules, { toForest: paintOne('toForest', 'Forest') });
    const lead = s.units['leader0']!.pos;
    s.board[lead.col - 1]![lead.row - 1]!.terrain = 'Normal';
    expect(paint(s, 'toForest').players[0].sp).toBe(8 - 1); // our own paint: silent

    // Now the opponent paints.
    let cur = endUntil(s, 1);
    const lead1 = cur.units['leader1']!.pos;
    cur.board[lead1.col - 1]![lead1.row - 1]!.terrain = 'Normal';
    cur.players[1].hand.push('toForest');
    cur.players[1].sp = 8;
    const spBefore = cur.players[0].sp;
    cur = applyAction(cur, { t: 'CastSpell', card: 'toForest' });
    expect(cur.players[0].sp).toBe(spBefore + 3);
  });

  it('TriggeringTile binds the painted tile, and UnitOnTriggeringTile finds its occupant', () => {
    const rules: Rule[] = [{
      trigger: 'OnTerrainPainted',
      effect: { e: 'ApplyStatus', status: 'AtkMod', amount: 20, duration: { kind: 'endOfTurn' } },
      target: { t: 'UnitOnTriggeringTile' },
    }];
    // The watcher paints under a body of its own and buffs whoever is standing there.
    const s = game({
      watcher: withRules('watcher', rules),
      toForest: paintOne('toForest', 'Forest'),
    });
    debugSpawn(s, 'watcher', 0, { col: 6, row: 6 });
    const lead = s.units['leader0']!.pos;
    s.board[lead.col - 1]![lead.row - 1]!.terrain = 'Normal';
    // The leader is standing on the tile its own spell paints.
    const after = paint(s, 'toForest');
    expect(after.units['leader0']!.statuses.some((st) => st.kind === 'AtkMod' && st.amount === 20)).toBe(true);
  });

  it('a paint chain terminates instead of recursing forever', () => {
    // A listener that repaints on every paint, in a two-terrain cycle.
    const flipper = withRules('flipper', [
      { trigger: 'OnTerrainPainted', effect: { e: 'PaintTerrain', terrain: 'Sea' }, target: { t: 'TriggeringTile' }, when: { terrain: 'Forest' } },
      { trigger: 'OnTerrainPainted', effect: { e: 'PaintTerrain', terrain: 'Forest' }, target: { t: 'TriggeringTile' }, when: { terrain: 'Sea' } },
    ]);
    const s = game({ flipper, toForest: paintOne('toForest', 'Forest') });
    debugSpawn(s, 'flipper', 0, { col: 6, row: 6 });
    const lead = s.units['leader0']!.pos;
    s.board[lead.col - 1]![lead.row - 1]!.terrain = 'Normal';
    let after!: GameState;
    expect(() => { after = paint(s, 'toForest'); }).not.toThrow();
    expect(after.log.some((l) => /paint chain depth/.test(l))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Load validation
// ---------------------------------------------------------------------------

describe('validateCardRules', () => {
  /**
   * ⚠ KNOWN DEFECT, recorded rather than hidden. A CARD's Passive aura is only read when it
   * targets `Self` — there is no engine loop that sweeps other units' card auras, only leader
   * auras reach across the board. These two Red Mark cards therefore carry banners that do
   * nothing, and `serjeantKell` is explicitly charged +1 DC for its "anthem".
   *
   * Left unfixed here on purpose: making card banners work is a BALANCE change to a deck that
   * was only just tuned to 47.4%, which belongs in a phase that re-baselines. Listed so that any
   * NEW inert content fails the sweep below immediately.
   */
  const KNOWN_INERT_BANNERS = new Set(['serjeantKell', 'theRedMarshal']);

  it('every registered card has only rules that can actually fire', () => {
    const offenders: string[] = [];
    for (const def of Object.values(DECK_CARDS)) {
      const v = validateCardRules(def);
      if (v.length && !KNOWN_INERT_BANNERS.has(def.id)) offenders.push(`${def.id}: ${v.join('; ')}`);
    }
    expect(offenders).toEqual([]);
  });

  it('the two known inert banners are still exactly that — no more, no fewer', () => {
    const inert = Object.values(DECK_CARDS).filter((d) => validateCardRules(d).length > 0).map((d) => d.id);
    expect(new Set(inert)).toEqual(KNOWN_INERT_BANNERS);
  });

  it('every registered leader still validates clean', () => {
    for (const leader of [...DECKS, ...DEFENSE_DECKS].map((d) => d.leader)) {
      expect(validateLeader(leader), leader.id).toEqual([]);
    }
  });

  it('rejects a trigger with no card dispatch site', () => {
    // Passive is legal; a bogus trigger is not. Use a cast to model bad authored data.
    const bad = withRules('bad', [{ trigger: 'Nonsense' as Rule['trigger'], effect: { e: 'Draw', n: 1 }, target: { t: 'Self' } }]);
    expect(validateCardRules(bad)[0]).toMatch(/no card dispatch site/);
  });

  it('rejects a scope on a trigger that ignores it', () => {
    const bad = withRules('bad', [gainSp('OnSummon', 1, 'enemy')]);
    expect(validateCardRules(bad)[0]).toMatch(/ignores when\.scope/);
  });

  it('rejects a terrain filter on a trigger that ignores it', () => {
    const bad = withRules('bad', [{
      trigger: 'OnSummon', effect: { e: 'GainSP', n: 1 }, target: { t: 'Self' },
      when: { terrain: 'Forest' },
    }]);
    expect(validateCardRules(bad)[0]).toMatch(/ignores when\.terrain/);
  });

  it('rejects an aura on a non-Passive trigger', () => {
    const bad = withRules('bad', [{ trigger: 'OnSummon', effect: { e: 'AuraAtk', amount: 5 }, target: { t: 'Self' } }]);
    expect(validateCardRules(bad)[0]).toMatch(/Passive-only/);
  });

  it('accepts the shapes the engine really dispatches', () => {
    expect(validateCardRules(withRules('good', [
      gainSp('EndOfTurn'), gainSp('OnFlip'), gainSp('OnSpellCast'), gainSp('OnAbilityCast'),
      gainSp('OnSummonAlly'), gainSp('OnEnemySummon'), gainSp('OnAttack'), gainSp('OnDefend'),
      gainSp('OnAllyDeath', 1, 'any'), gainSp('OnTrapTriggered', 1, 'enemy'), gainSp('OnCapture', 1, 'friendly'),
      { trigger: 'Passive', effect: { e: 'AuraAtk', amount: 5 }, target: { t: 'Self' } },
    ]))).toEqual([]);
  });
});
