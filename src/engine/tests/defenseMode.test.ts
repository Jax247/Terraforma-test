// Two-stat combat (Rules Spec §5) — the defense stance, ratified into the core rules 2026-08-04.
// Covers the combat table (A>D break / A=D hold / A<D reflect), Piercing as an overkill-to-LP
// converter that grants no DEF discount, the face-down flip→defense hook, the helpless-defender
// carve-out, and the DC rubric's job of keeping pure-wall decks unaffordable.
import { describe, expect, it } from 'vitest';
import { applyAction, debugSpawn, legalActions } from '../engine';
import { deckCost, STANDARD_DC_CAP } from '../content/decks';
import { ANVIL_DECK } from '../content/decks/anvil';
import { PIERCER_DECK } from '../content/decks/piercer';
import { MIXED_DECK } from '../content/decks/mixed';
import { freshGame } from './helpers';
import type { CardDef, GameState, Unit } from '../types';

const CARDS: Record<string, CardDef> = {
  vanilla: { kind: 'unit', id: 'vanilla', name: 'Vanilla', type: 'Warrior', level: 3, atk: 30, def: 30, dc: 3, keywords: [], rules: [] },
  pierce: { kind: 'unit', id: 'pierce', name: 'Pierce', type: 'Warrior', level: 3, atk: 30, def: 30, dc: 3, keywords: ['Piercing'], rules: [] },
  // Low ATK, high DEF — its two stats differ so a test can prove which one combat used.
  wall: { kind: 'unit', id: 'wall', name: 'Wall', type: 'Warrior', level: 3, atk: 20, def: 60, dc: 3, keywords: [], rules: [] },
};

function setup(): GameState {
  const s = freshGame({ extraCards: CARDS });
  s.board[3]![3]!.terrain = 'Normal'; // battle tile (4,4) neutral so terrain never skews stats
  return s;
}

/** Spawn a unit and force exact stats/stance. */
function place(s: GameState, cardId: string, owner: 0 | 1, pos: { col: number; row: number }, over: Partial<Unit>): Unit {
  const u = debugSpawn(s, cardId, owner, pos);
  Object.assign(u, over);
  return u;
}

/** Attacker at (4,5) charges a defender parked at (4,4). Returns the post-combat state. */
function clash(s: GameState, atk: number, defStats: Partial<Unit>, attackerCard = 'vanilla'): GameState {
  place(s, 'vanilla', 1, { col: 4, row: 4 }, { baseAtk: 10, baseDef: 30, stance: 'defense', ...defStats });
  const a = place(s, attackerCard, 0, { col: 4, row: 5 }, { baseAtk: atk });
  return applyAction(s, { t: 'Move', unit: a.id, to: { col: 4, row: 4 } });
}

const lp = (s: GameState, p: 0 | 1): number => s.players[p].leaderLife;
const defenderAlive = (s: GameState): boolean => Object.values(s.units).some((u) => u.owner === 1 && !u.isLeader);

describe('the defense combat table (non-piercing)', () => {
  it('A > D: wall broken, destroyed, but NO LP to its owner', () => {
    const s0 = setup();
    const [l0, l1] = [lp(s0, 0), lp(s0, 1)];
    const s = clash(s0, 70, { baseDef: 60 });
    expect(defenderAlive(s)).toBe(false);
    expect(lp(s, 1)).toBe(l1); // no overflow through a defending unit — that is Piercing's job
    expect(lp(s, 0)).toBe(l0);
  });

  it('A < D: wall holds and reflects (D − A) to the attacker’s owner', () => {
    const s0 = setup();
    const l0 = lp(s0, 0);
    const s = clash(s0, 40, { baseDef: 60 });
    expect(defenderAlive(s)).toBe(true);
    expect(lp(s, 0)).toBe(l0 - 20); // reflect 60 − 40
  });

  it('A < D: the wall never counter-KILLS, it only reflects', () => {
    const s0 = setup();
    const s = clash(s0, 40, { baseDef: 60 });
    expect(Object.values(s.units).some((u) => u.owner === 0 && !u.isLeader)).toBe(true);
  });

  it('A = D: wall holds, no LP either way', () => {
    const s0 = setup();
    const [l0, l1] = [lp(s0, 0), lp(s0, 1)];
    const s = clash(s0, 60, { baseDef: 60 });
    expect(defenderAlive(s)).toBe(true);
    expect(lp(s, 0)).toBe(l0);
    expect(lp(s, 1)).toBe(l1);
  });

  it('resolves against DEF, not ATK — a low-ATK/high-DEF body is a wall', () => {
    const s0 = setup();
    // ATK 20 / DEF 60 vs a 40 attacker. Vs ATK it would die; vs DEF it holds and reflects.
    const s = clash(s0, 40, { baseAtk: 20, baseDef: 60 });
    expect(defenderAlive(s)).toBe(true);
  });
});

/**
 * Piercing converts overkill into LP and buys NOTHING else — in particular no DEF discount
 * (the prototype's `ignoreFrac`, ratified to 0 on 2026-08-04). The second test is the one that
 * pins that: at the old 0.5 ignore it would break the wall instead of bouncing off it.
 */
describe('Piercing converts overkill to LP', () => {
  it('tramples the whole margin through a wall it breaks', () => {
    const s0 = setup();
    const l1 = lp(s0, 1);
    const s = clash(s0, 70, { baseDef: 60 }, 'pierce');
    expect(defenderAlive(s)).toBe(false);
    expect(lp(s, 1)).toBe(l1 - 10); // trample 70 − 60
  });

  it('does NOT reduce DEF — a wall taller than its ATK still stops it dead', () => {
    const s0 = setup();
    const l0 = lp(s0, 0);
    const s = clash(s0, 40, { baseDef: 60 }, 'pierce');
    expect(defenderAlive(s)).toBe(true);
    expect(lp(s, 0)).toBe(l0 - 20); // reflect 60 − 40, exactly as a non-piercer suffers
  });

  it('is the ONLY way LP passes a wall — the same break by a non-piercer concedes nothing', () => {
    const l1 = lp(setup(), 1);
    expect(lp(clash(setup(), 70, { baseDef: 60 }, 'pierce'), 1)).toBe(l1 - 10);
    expect(lp(clash(setup(), 70, { baseDef: 60 }, 'vanilla'), 1)).toBe(l1);
  });
});

/**
 * Ruling 2026-08-04: a LEADER attacking a unit in defense stance resolves on the same table as
 * any other attacker. Before this the `attacker.isLeader` branch was taken first and resolved
 * against the defender's ATK, so the stance meant nothing against a leader.
 */
describe('a leader attacks a defending unit like anything else', () => {
  /** Enemy leader at (4,5) walks into our defender at (4,4). */
  function leaderCharges(s: GameState, leaderAtk: number, defStats: Partial<Unit>): GameState {
    place(s, 'vanilla', 1, { col: 4, row: 4 }, { baseAtk: 10, baseDef: 30, stance: 'defense', ...defStats });
    const leader = Object.values(s.units).find((u) => u.owner === 0 && u.isLeader)!;
    s.board[4]![3]!.occupant = undefined;
    leader.pos = { col: 4, row: 5 };
    s.board[4]![3]!.occupant = { kind: 'unit', id: leader.id };
    leader.baseAtk = leaderAtk;
    return applyAction(s, { t: 'Move', unit: leader.id, to: { col: 4, row: 4 } });
  }

  it('resolves against DEF, not ATK — a wall stops a leader it out-DEFs', () => {
    const s0 = setup();
    const l0 = lp(s0, 0);
    // Leader 40 vs a 20 ATK / 60 DEF wall. Against ATK it would kill it outright.
    const s = leaderCharges(s0, 40, { baseAtk: 20, baseDef: 60 });
    expect(defenderAlive(s)).toBe(true);
    expect(lp(s, 0)).toBe(l0 - 20); // reflect 60 − 40 onto the attacking leader's own pool
  });

  it('breaks a wall it out-stats, and takes no LP for it (leaders carry no Piercing)', () => {
    const s0 = setup();
    const [l0, l1] = [lp(s0, 0), lp(s0, 1)];
    const s = leaderCharges(s0, 70, { baseAtk: 20, baseDef: 60 });
    expect(defenderAlive(s)).toBe(false);
    expect(lp(s, 1)).toBe(l1); // binary for the unit: no overflow through a wall
    expect(lp(s, 0)).toBe(l0);
  });

  it('gets NO flank bonus — leaders neither grant nor receive one', () => {
    const s0 = setup();
    const l0 = lp(s0, 0);
    // Two friendly bodies flank the battle tile. A unit attacker would gain +10 here; a leader
    // must not, so the reflect is unchanged at 60 − 40.
    place(s0, 'vanilla', 0, { col: 3, row: 4 }, { baseAtk: 10 });
    place(s0, 'vanilla', 0, { col: 5, row: 4 }, { baseAtk: 10 });
    const s = leaderCharges(s0, 40, { baseAtk: 20, baseDef: 60 });
    expect(defenderAlive(s)).toBe(true);
    expect(lp(s, 0)).toBe(l0 - 20);
  });

  it('a leader still fights an ATTACK-stance unit the old way (full-ATK strikeback)', () => {
    const s0 = setup();
    const l0 = lp(s0, 0);
    // 30 ATK defender in attack stance vs a 20 ATK leader: survives, strikes back for its FULL
    // ATK, not a margin. That branch is untouched by the ruling.
    const s = leaderCharges(s0, 20, { baseAtk: 30, baseDef: 5, stance: 'attack' });
    expect(defenderAlive(s)).toBe(true);
    expect(lp(s, 0)).toBe(l0 - 30);
  });
});

describe('a helpless defender holds, but reflects nothing', () => {
  it('a stunned wall still stops the attack, and is not punished for it', () => {
    const s0 = setup();
    const l0 = lp(s0, 0);
    const s = clash(s0, 40, { baseDef: 60, statuses: [{ id: 'st1', kind: 'Stunned', amount: 0, duration: { kind: 'turns', turnsLeft: 2 } }] });
    expect(defenderAlive(s)).toBe(true); // suppressing the counter is not a free break
    expect(lp(s, 0)).toBe(l0); // ...but no reflect either
  });
});

/**
 * ⚠ 2026-08-16 RULE CHANGE, from playtest. Face-down used to MEAN defense position: a set unit
 * revealed by an attack was forced into 'defense' and fought on its DEF, while the very same card
 * flip-summoned by its owner came up in 'attack'. Same card, different stat, decided purely by how
 * it happened to be revealed.
 *
 * Concealment and posture are now orthogonal. DEF applies when a unit is in defense position —
 * face-down or face-up — and nowhere else. A set unit chooses its stance when it goes down and
 * keeps it through either reveal path.
 */
describe('a revealed face-down unit keeps the stance it was set in', () => {
  /** Face-down enemy `wall` (ATK 20 / DEF 60) at the battle tile, holding `stance`. */
  const setWall = (s: ReturnType<typeof setup>, stance: 'attack' | 'defense') => {
    s.setCards['sc1'] = { id: 'sc1', owner: 1, cardId: 'wall', kind: 'unit', pos: { col: 4, row: 4 }, hasActed: false, setTurnCount: 0, stance };
    s.board[3]![3]!.occupant = { kind: 'set', id: 'sc1' };
  };

  it('set in ATTACK: resolves vs its ATK, so being hidden is no longer a free wall', () => {
    const s = setup();
    setWall(s, 'attack');
    const a = place(s, 'vanilla', 0, { col: 4, row: 5 }, { baseAtk: 40 });
    const l0 = lp(s, 0);
    const after = applyAction(s, { t: 'Move', unit: a.id, to: { col: 4, row: 4 } });
    // vs ATK 20: 40 > 20, the wall dies and the attacker takes the tile. Under the old rule the
    // forced defense stance resolved this against DEF 60 and the attacker bounced off instead.
    expect(Object.values(after.units).find((u) => u.owner === 1 && !u.isLeader)).toBeUndefined();
    expect(after.units[a.id]!.pos).toEqual({ col: 4, row: 4 });
    expect(lp(after, 0)).toBe(l0); // no reflect: there was no wall to reflect
  });

  it('set in DEFENSE: resolves vs its DEF, exactly as a face-up braced unit would', () => {
    const s = setup();
    setWall(s, 'defense');
    const a = place(s, 'vanilla', 0, { col: 4, row: 5 }, { baseAtk: 40 });
    const l0 = lp(s, 0);
    const after = applyAction(s, { t: 'Move', unit: a.id, to: { col: 4, row: 4 } });
    const flipped = Object.values(after.units).find((u) => u.owner === 1 && !u.isLeader);
    expect(flipped).toBeDefined();
    expect(flipped!.stance).toBe('defense');
    expect(lp(after, 0)).toBe(l0 - 20); // 40 < DEF 60 → holds, reflects the 20 margin
  });

  it('the stance survives a flip-summon too — both reveal paths agree', () => {
    for (const stance of ['attack', 'defense'] as const) {
      const s = setup();
      s.setCards['sc1'] = { id: 'sc1', owner: 0, cardId: 'wall', kind: 'unit', pos: { col: 2, row: 2 }, hasActed: false, setTurnCount: -1, stance };
      s.board[1]![1]!.occupant = { kind: 'set', id: 'sc1' };
      const after = applyAction(s, { t: 'FlipCard', set: 'sc1' });
      const up = Object.values(after.units).find((u) => u.owner === 0 && !u.isLeader);
      expect(up?.stance).toBe(stance);
    }
  });
});

describe('stance is a core action, always offered', () => {
  it('a settled unit can take defense, and a defender can only stand back up', () => {
    const s = setup();
    const u = place(s, 'vanilla', 0, { col: 4, row: 5 }, { sickTurns: 0 });
    expect(legalActions(s)).toContainEqual({ t: 'SetStance', unit: u.id, stance: 'defense' });

    const after = applyAction(s, { t: 'SetStance', unit: u.id, stance: 'defense' });
    after.units[u.id]!.hasActed = false; // next turn, still defending
    const acts = legalActions(after).filter((a) => 'unit' in a && a.unit === u.id);
    expect(acts).toEqual([{ t: 'SetStance', unit: u.id, stance: 'attack' }]);
  });

  it('leaders never defend', () => {
    const s = setup();
    const leader = Object.values(s.units).find((x) => x.owner === 0 && x.isLeader)!;
    expect(legalActions(s)).not.toContainEqual({ t: 'SetStance', unit: leader.id, stance: 'defense' });
  });
});

describe('DC pricing keeps pure-wall decks out of the budget', () => {
  // The rubric's job is to make an ALL-wall deck unaffordable, which is not the same as making
  // Anvil illegal. Anvil is a legal deck now (2026-07-29, when the probe decks were brought
  // under the copy limit) precisely BECAUSE the pricing forced it to spend a third of its slots
  // on cheap chaff and support. So the invariant is tested directly: build the wall-stack the
  // rubric is meant to forbid and confirm it cannot be paid for.
  it('a deck of nothing but high-DEF walls cannot be afforded', () => {
    const wallIds = Object.values(ANVIL_DECK.cards)
      .filter((d) => d.kind === 'unit' && (d.def ?? 0) >= 45)
      .map((d) => d.id);
    expect(wallIds.length).toBeGreaterThan(0);
    // 40 cards drawn only from the walls, at the legal 3-copy limit.
    const list: string[] = [];
    for (let i = 0; list.length < 40; i++) list.push(wallIds[i % wallIds.length]!);
    const allWalls = { ...ANVIL_DECK, id: 'allWalls', list };
    expect(deckCost(allWalls)).toBeGreaterThan(STANDARD_DC_CAP);
  });

  it('the diluted probe decks are all legal builds', () => {
    for (const deck of [ANVIL_DECK, MIXED_DECK, PIERCER_DECK]) {
      expect(deckCost(deck)).toBeLessThanOrEqual(STANDARD_DC_CAP);
    }
  });
});
