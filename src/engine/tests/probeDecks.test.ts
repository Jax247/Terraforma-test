// The two-stat probe decks as CONTENT: the DEF-side vocabulary added on 2026-08-02
// (AuraDef passive auras, the DefMod timed status) and the two leaders + card interactions that
// vocabulary exists to express. The combat table itself lives in defenseMode.test.ts.
import { describe, expect, it } from 'vitest';
import { applyAction, debugSpawn } from '../engine';
import { effectiveDef } from '../stats';
import { leaderOf, mooreAdjacent, tileAt } from '../board';
import { ANVIL_DECK } from '../content/decks/anvil';
import { PIERCER_DECK } from '../content/decks/piercer';
import { MIXED_DECK } from '../content/decks/mixed';
import { freshGame, passRounds, teleport } from './helpers';
import type { CardDef, Coord, GameState, UnitCardDef } from '../types';

const PROBE_CARDS: Record<string, CardDef> = {
  ...ANVIL_DECK.cards,
  ...PIERCER_DECK.cards,
  ...MIXED_DECK.cards,
  // A self-targeted DEF aura — the unit-level twin of Bastion's leader aura. No printed card
  // uses it yet (the archetype wanted the leader version), so this is what covers the branch.
  aegisPlate: {
    kind: 'unit', id: 'aegisPlate', name: 'Aegis Plate', type: 'Machine', level: 2, atk: 10, def: 30, dc: 3,
    keywords: [],
    rules: [{ trigger: 'Passive', effect: { e: 'AuraDef', amount: 15 }, target: { t: 'Self' } }],
  },
};

/** Anvil (P0, Bastion) vs Piercer (P1, Vanguard), on a board whose terrain the test sets itself. */
function probeGame(): GameState {
  const s = freshGame({
    extraCards: PROBE_CARDS,
    leaders: [ANVIL_DECK.leader, PIERCER_DECK.leader],
    decks: [[...ANVIL_DECK.list], [...PIERCER_DECK.list]],
    fusionPools: [[], []],
  });
  for (let col = 1; col <= 7; col++) {
    for (let row = 1; row <= 7; row++) tileAt(s.board, { col, row }).terrain = 'Normal';
  }
  return s;
}

function emptyRingTile(s: GameState, player: 0 | 1): Coord {
  const leader = leaderOf(s, player);
  const tile = mooreAdjacent(leader.pos).find((c) => !tileAt(s.board, c).occupant);
  if (!tile) throw new Error('no empty summon tile');
  return tile;
}

describe('AuraDef — the DEF-side twin of AuraAtk', () => {
  it("Bastion's aegis: +10 DEF to friendly Terra/Machine, but only while they stand on Mountain", () => {
    const s = probeGame();
    const wall = debugSpawn(s, 'stoneWall', 0, { col: 4, row: 4 });
    expect(effectiveDef(s, wall)).toBe(45); // base only: Normal ground, no aura

    tileAt(s.board, { col: 4, row: 4 }).terrain = 'Mountain';
    // 45 base + 10 Mountain (Terra's favored terrain) + 10 Bastion aegis.
    expect(effectiveDef(s, wall)).toBe(65);
  });

  it('the aegis reads type and ownership, not just terrain', () => {
    const s = probeGame();
    tileAt(s.board, { col: 4, row: 4 }).terrain = 'Mountain';
    tileAt(s.board, { col: 4, row: 5 }).terrain = 'Mountain';

    // Enemy Machine on Mountain: Bastion is not its leader, so no aegis (Mountain +10 only).
    const enemyDrill = debugSpawn(s, 'boneDrill', 1, { col: 4, row: 5 });
    expect(effectiveDef(s, enemyDrill)).toBe(30);

    // Friendly Warrior on Mountain: right owner, wrong type — and Warriors do not favor Mountain.
    const friendlyBlade = debugSpawn(s, 'rushBlade', 0, { col: 4, row: 4 });
    expect(effectiveDef(s, friendlyBlade)).toBe(10);
  });

  it('a unit-level Passive/Self AuraDef stacks on top of terrain and the leader aura', () => {
    const s = probeGame();
    const plate = debugSpawn(s, 'aegisPlate', 0, { col: 4, row: 4 });
    expect(effectiveDef(s, plate)).toBe(45); // 30 base + 15 own aura

    tileAt(s.board, { col: 4, row: 4 }).terrain = 'Mountain';
    expect(effectiveDef(s, plate)).toBe(65); // + 10 Mountain (Machine) + 10 Bastion aegis
  });

  it('DEF auras are inert on the ATK side — a warden buffs walls, not swings', () => {
    const s = probeGame();
    tileAt(s.board, { col: 4, row: 4 }).terrain = 'Mountain';
    const wall = debugSpawn(s, 'stoneWall', 0, { col: 4, row: 4 });
    // 10 base + 10 Mountain, and nothing from the aegis.
    expect(wall.baseAtk).toBe(10);
    expect(effectiveDef(s, wall) - wall.baseDef).toBe(20);
  });
});

describe('DefMod — Aegis and Sunder', () => {
  it('Aegis shields an adjacent friendly for +20 DEF, and it wears off', () => {
    let s = probeGame();
    const tile = emptyRingTile(s, 0);
    const wall = debugSpawn(s, 'stoneWall', 0, tile);
    s.players[0].sp = 8;

    s = applyAction(s, { t: 'ActivateAbility', targets: [tile] });
    expect(effectiveDef(s, s.units[wall.id]!)).toBe(65); // 45 + 20

    // turnsLeft 2 = live for exactly 2 of the owner's OWN turns after the one it landed on.
    s = passRounds(s, 1);
    expect(effectiveDef(s, s.units[wall.id]!)).toBe(65); // owner turn 1 of 2
    s = passRounds(s, 1);
    expect(effectiveDef(s, s.units[wall.id]!)).toBe(65); // owner turn 2 of 2
    s = passRounds(s, 1);
    expect(effectiveDef(s, s.units[wall.id]!)).toBe(45); // spent
  });

  it("Aegis is located — Bastion cannot shield a wall he isn't standing by", () => {
    const s = probeGame();
    const far = { col: 7, row: 7 };
    debugSpawn(s, 'stoneWall', 0, far);
    s.players[0].sp = 8;
    expect(() => applyAction(s, { t: 'ActivateAbility', targets: [far] })).toThrow(/reach/);
  });

  it("Sunder turns a wall a NON-piercer cannot break into one it can", () => {
    // The whole point of the Breaker's active: the piercing keyword is not the deck's only way
    // through. Berserker is a Fiend, so Vanguard's Warrior banner does not muddy the arithmetic.
    const setup = (): { s: GameState; wallPos: Coord; attackerId: string } => {
      const s = probeGame();
      const wallPos = { col: 4, row: 4 };
      const wall = debugSpawn(s, 'ironBulwark', 0, wallPos); // 20/60
      wall.stance = 'defense';
      const attacker = debugSpawn(s, 'berserker', 1, { col: 4, row: 5 }); // 45 ATK, no Piercing
      teleport(s, leaderOf(s, 1).id, { col: 5, row: 4 }); // adjacent to the wall, for the located cast
      s.active = 1;
      s.players[1].sp = 8;
      return { s, wallPos, attackerId: attacker.id };
    };

    // Untouched: 45 < 60, the wall holds and reflects 15 to the attacker's owner.
    const plain = setup();
    const held = applyAction(plain.s, { t: 'Move', unit: plain.attackerId, to: plain.wallPos });
    expect(Object.values(held.units).some((u) => u.cardId === 'ironBulwark')).toBe(true);
    expect(held.players[1].leaderLife).toBe(200 - 15);

    // Sundered: 60 − 20 = 40, so 45 breaks it.
    const sundered = setup();
    let s = applyAction(sundered.s, { t: 'ActivateAbility', targets: [sundered.wallPos] });
    s = applyAction(s, { t: 'Move', unit: sundered.attackerId, to: sundered.wallPos });
    expect(Object.values(s.units).some((u) => u.cardId === 'ironBulwark')).toBe(false);
    expect(s.players[1].leaderLife).toBe(200); // no reflect — the break was clean
  });
});

describe('deck-vs-deck interactions the cards were written for', () => {
  it("Anchored Stone Wall shrugs off Piercer's Grapnel Yank", () => {
    let s = probeGame();
    const pos = { col: 4, row: 4 };
    debugSpawn(s, 'stoneWall', 0, pos);
    s.active = 1;
    s.players[1].sp = 8;
    s.players[1].hand.push('grapnelYank');
    s = applyAction(s, { t: 'CastSpell', card: 'grapnelYank', targets: [pos] });
    expect(Object.values(s.units).find((u) => u.cardId === 'stoneWall')!.pos).toEqual(pos);

    // Control: the same pull moves a wall that is not Anchored.
    let t = probeGame();
    debugSpawn(t, 'ironBulwark', 0, pos);
    t.active = 1;
    t.players[1].sp = 8;
    t.players[1].hand.push('grapnelYank');
    t = applyAction(t, { t: 'CastSpell', card: 'grapnelYank', targets: [pos] });
    expect(Object.values(t.units).find((u) => u.cardId === 'ironBulwark')!.pos).not.toEqual(pos);
  });

  it('Sentry Golem taxes standing next to the line, without being attacked first', () => {
    // Anvil's answer to an opponent that simply declines the trade: reflect only pays when the
    // enemy chooses to attack, this fires whether or not anyone does. Damage destroys a unit whose
    // effective ATK it meets, so 10 is chip against a real body and lethal to the chaff that
    // bunches up around a wall to flank it.
    let s = probeGame();
    debugSpawn(s, 'sentryGolem', 0, { col: 4, row: 4 });
    const adjacent = debugSpawn(s, 'bulwarkAcolyte', 1, { col: 4, row: 5 }); // 10 ATK — dies
    const nearby = debugSpawn(s, 'bulwarkAcolyte', 1, { col: 6, row: 6 });   // out of reach
    const bigBody = debugSpawn(s, 'berserker', 1, { col: 5, row: 4 });       // 45 ATK — survives

    s = passRounds(s, 1); // the burn fires at the start of the golem's controller's turn
    expect(s.units[adjacent.id]).toBeUndefined();
    expect(s.units[nearby.id]).toBeDefined();
    expect(s.units[bigBody.id]).toBeDefined();
  });

  it('the two spring runners pay their decks in their own currency', () => {
    // Anvil's scout draws, Piercer's skirmisher takes SP — the same objective, read through each
    // archetype's bottleneck. Random playouts almost never step on a spring, so this is the only
    // coverage these two rules get.
    const spring = { col: 4, row: 4 };
    const run = (cardId: string, owner: 0 | 1) => {
      const s = probeGame();
      const tile = tileAt(s.board, spring);
      tile.spring = true;
      tile.springActive = true;
      const u = debugSpawn(s, cardId, owner, { col: 4, row: 5 });
      s.active = owner;
      const before = { hand: s.players[owner].hand.length, sp: s.players[owner].sp };
      const after = applyAction(s, { t: 'Move', unit: u.id, to: spring });
      return { before, hand: after.players[owner].hand.length, sp: after.players[owner].sp };
    };

    const scout = run('pebbleScout', 0);
    expect(scout.hand).toBe(scout.before.hand + 1);
    expect(scout.sp).toBe(scout.before.sp + 3); // the spring's own +3, no card SP

    const skirmisher = run('skirmisher', 1);
    expect(skirmisher.hand).toBe(skirmisher.before.hand);
    expect(skirmisher.sp).toBe(skirmisher.before.sp + 3 + 2); // spring +3, card +2
  });

  it("War Hound's start-of-turn dash re-grants every turn instead of stacking", () => {
    let s = probeGame();
    const hound = debugSpawn(s, 'warhound', 0, { col: 4, row: 4 });
    s = passRounds(s, 1);
    expect(s.units[hound.id]!.extraMove).toBe(1);
    s = passRounds(s, 1);
    expect(s.units[hound.id]!.extraMove).toBe(1); // cleared in the start phase, then re-granted
  });

  it('Berserker keeps the ATK it takes from a kill, permanently', () => {
    let s = probeGame();
    const berserker = debugSpawn(s, 'berserker', 0, { col: 4, row: 5 }); // 45 ATK
    debugSpawn(s, 'rushBlade', 1, { col: 4, row: 4 }); // 20 ATK, dies
    s = applyAction(s, { t: 'Move', unit: berserker.id, to: { col: 4, row: 4 } });
    expect(s.units[berserker.id]!.statuses.some((st) => st.kind === 'AtkMod' && st.amount === 10)).toBe(true);
    s = passRounds(s, 2);
    expect(s.units[berserker.id]!.statuses.some((st) => st.kind === 'AtkMod')).toBe(true); // permanent
  });
});

describe('the probe decks read as decks, not stat sheets', () => {
  /**
   * Deliberate vanillas, each with a reason stated in its deck file: for the walls the statline
   * is already the whole DC budget, and for the piercers/Frenzy bodies the keyword IS the card.
   * Anything NOT on this list must carry a keyword or a printed rule — that is the regression
   * this test exists to prevent.
   */
  const INTENDED_VANILLA = new Set([
    'ironBulwark', 'graniteRampart', 'fortressTitan', // Anvil: DEF is the card
    'rushBlade',                                       // Piercer: 1-SP tempo filler
    'houndmaster',                                     // pool-only body for Mixed
    'vanguardPikeman', 'bulwarkRider',                 // Mixed: the stance decision is the card
  ]);

  for (const deck of [ANVIL_DECK, PIERCER_DECK, MIXED_DECK]) {
    it(`${deck.name}: every unit has a keyword or a rule, or is a documented vanilla`, () => {
      const blanks = [...new Set(deck.list)]
        .map((id) => deck.cards[id]!)
        .filter((d): d is UnitCardDef => d.kind === 'unit')
        .filter((d) => d.keywords.length === 0 && d.rules.length === 0)
        .map((d) => d.id)
        .filter((id) => !INTENDED_VANILLA.has(id));
      expect(blanks).toEqual([]);
    });
  }

  it('each probe leader has a passive or an ability that is not a plain terrain paint', () => {
    // The defect this pass fixed: three leaders whose entire contribution was painting a line,
    // one of them duplicating a spell in its own deck.
    for (const deck of [ANVIL_DECK, PIERCER_DECK, MIXED_DECK]) {
      const { leader } = deck;
      const paintsOnly = leader.ability.effects.every((l) => l.effect.e === 'PaintTerrain');
      expect(paintsOnly && leader.rules.length === 0, `${leader.name} is still a plain painter`).toBe(false);
    }
  });

  it('no leader ability duplicates a spell printed in its own deck', () => {
    for (const deck of [ANVIL_DECK, PIERCER_DECK, MIXED_DECK]) {
      const abilityText = JSON.stringify(deck.leader.ability.effects);
      const dupes = [...new Set(deck.list)]
        .map((id) => deck.cards[id]!)
        .filter((d) => d.kind === 'spell' && JSON.stringify(d.effects) === abilityText)
        .map((d) => d.id);
      expect(dupes, `${deck.leader.name} duplicates ${dupes.join(', ')}`).toEqual([]);
    }
  });
});
