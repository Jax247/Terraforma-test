// The Red Mark — first blueprint deck of the 2026-08 deck overhaul.
//
// These tests are deliberately about the things the DECK EXISTS TO PROVE, not about its stat line:
// a leader that shoots, a bonus that switches off the moment something closes, a mark that travels
// from the leader to the payoff card, and the signature "push it back out and shoot it" line. If
// the deck's identity ever quietly erodes into a pile of Warriors, these fail.
import { describe, expect, it } from 'vitest';
import { applyAction, debugSpawn, legalActions } from '../engine';
import { makeBoard, rangedTargets, sameCoord } from '../board';
import { effectiveAtk } from '../stats';
import { REDMARK_CARDS, REDMARK_DECK, SABLE } from '../content/decks/redmark';
import { WILDGROWTH_DECK } from '../content/decks/wildgrowth';
import { freshGame } from './helpers';
import type { GameState, UnitCardDef } from '../types';

/** The Red Mark (P1) on neutral ground, so terrain never skews an ATK assertion. */
function game(): GameState {
  const s = freshGame({
    board: makeBoard(() => 'Normal'),
    leaders: [SABLE, WILDGROWTH_DECK.leader],
    extraCards: { ...REDMARK_CARDS, ...WILDGROWTH_DECK.cards },
    decks: [REDMARK_DECK.list, WILDGROWTH_DECK.list],
  });
  return s;
}

const leaderOfP1 = (s: GameState) => Object.values(s.units).find((u) => u.isLeader && u.owner === 0)!;

describe('Sable shoots — the ranged leader', () => {
  it('fires at exactly 2', () => {
    const s = game();
    const sable = leaderOfP1(s);
    expect(sable.range).toBe(2);
    // ⚠ NOT a Beast/Verdant body: P1's leader is Briar, whose rebuilt passive pays +10 to her own
    // types while they stand in the ENEMY half — which is exactly where this prey has to be.
    const prey = debugSpawn(s, 'arrowRunner', 1, { col: 4, row: 3 }); // Warrior, 2 tiles from (4,1)
    const after = applyAction(s, { t: 'RangedAttack', unit: sable.id, target: prey.pos });
    expect(after.units[prey.id]).toBeUndefined();
    expect(after.units[sable.id]!.pos).toEqual({ col: 4, row: 1 }); // never left its tile
  });

  it('cannot shoot something that has closed on it — reach is not safety', () => {
    const s = game();
    const sable = leaderOfP1(s);
    const prey = debugSpawn(s, 'thornfang', 1, { col: 4, row: 2 }); // adjacent = dead zone
    expect(() => applyAction(s, { t: 'RangedAttack', unit: sable.id, target: prey.pos }))
      .toThrow(/exactly 2 orthogonal tiles/);
    expect(legalActions(s).some((a) => a.t === 'RangedAttack' && a.unit === sable.id)).toBe(false);
  });
});

describe('Kept Discipline — the deck thesis as a rule', () => {
  it('a Warrior is +10 while unengaged, and loses it the moment anything closes', () => {
    const s = game();
    const bow = debugSpawn(s, 'redFletchBowman', 0, { col: 2, row: 4 });
    const alone = effectiveAtk(s, s.units[bow.id]!);
    debugSpawn(s, 'thornfang', 1, { col: 2, row: 5 }); // steps into contact
    expect(effectiveAtk(s, s.units[bow.id]!)).toBe(alone - 10);
  });

  it('a FRIENDLY neighbour does not switch it off — only enemies engage you', () => {
    const s = game();
    const bow = debugSpawn(s, 'redFletchBowman', 0, { col: 2, row: 4 });
    const alone = effectiveAtk(s, s.units[bow.id]!);
    debugSpawn(s, 'arrowRunner', 0, { col: 2, row: 5 });
    expect(effectiveAtk(s, s.units[bow.id]!)).toBe(alone);
  });

  it('a diagonal enemy is staging, not engagement — matching the 4-directional attack rule', () => {
    const s = game();
    const bow = debugSpawn(s, 'redFletchBowman', 0, { col: 2, row: 4 });
    const alone = effectiveAtk(s, s.units[bow.id]!);
    debugSpawn(s, 'thornfang', 1, { col: 3, row: 5 });
    expect(effectiveAtk(s, s.units[bow.id]!)).toBe(alone);
  });

  it("Quiet Marksman carries the same rule on a card, so it survives the leader's death", () => {
    const s = game();
    const q = debugSpawn(s, 'quietMarksman', 0, { col: 2, row: 4 });
    const clear = effectiveAtk(s, s.units[q.id]!);
    debugSpawn(s, 'thornfang', 1, { col: 2, row: 5 });
    // Loses BOTH the leader aura and its own self-buff: 20 of the 10+10.
    expect(effectiveAtk(s, s.units[q.id]!)).toBe(clear - 20);
  });
});

describe('Red Mark — the leader marks, the company kills', () => {
  function marked(s: GameState, targetPos: { col: number; row: number }) {
    s.players[0].sp = 8;
    return applyAction(s, { t: 'ActivateAbility', targets: [targetPos] });
  }

  it('the mark sticks, and is permanent', () => {
    let s = game();
    const prey = debugSpawn(s, 'thornfang', 1, { col: 4, row: 3 });
    s = marked(s, prey.pos);
    expect(s.units[prey.id]!.statuses.some((st) => st.kind === 'Marked')).toBe(true);
  });

  it('marking does NOT stack on re-application', () => {
    let s = game();
    const prey = debugSpawn(s, 'thornfang', 1, { col: 4, row: 3 });
    s = marked(s, prey.pos);
    s.players[0].sp = 8;
    s = applyAction(s, { t: 'ActivateAbility', targets: [prey.pos] });
    expect(s.units[prey.id]!.statuses.filter((st) => st.kind === 'Marked')).toHaveLength(1);
  });

  it('Tarr hits a marked target harder — but only as the attacker', () => {
    const s = game();
    const tarr = debugSpawn(s, 'markedWardenTarr', 0, { col: 2, row: 4 });
    const prey = debugSpawn(s, 'thornfang', 1, { col: 2, row: 6 }); // exactly range 2
    const ctx = { role: 'attacker' as const, battleTile: prey.pos, opponentId: prey.id };
    const before = effectiveAtk(s, s.units[tarr.id]!, ctx);
    prey.statuses.push({ id: 'm', kind: 'Marked', amount: 0, duration: { kind: 'permanent' } });
    expect(effectiveAtk(s, s.units[tarr.id]!, ctx)).toBe(before + 10);
    // Never outside an attack, and never on defence.
    expect(effectiveAtk(s, s.units[tarr.id]!)).toBe(before - 0);
    const asDefender = { role: 'defender' as const, battleTile: prey.pos, opponentId: prey.id };
    expect(effectiveAtk(s, s.units[tarr.id]!, asDefender)).toBe(effectiveAtk(s, s.units[tarr.id]!));
  });

  it('a LEADER can be marked — Marked is a designator, not crowd control', () => {
    // Load-bearing: leaders are immune to the denial statuses, and if Marked had been lumped in
    // with them the deck's own ability would fizzle against the only target that always matters.
    let s = game();
    const enemyLeader = Object.values(s.units).find((u) => u.isLeader && u.owner === 1)!;
    s = marked(s, enemyLeader.pos);
    expect(s.units[enemyLeader.id]!.statuses.some((st) => st.kind === 'Marked')).toBe(true);
  });
});

describe('the signature line — push it back out, then shoot it', () => {
  it('an enemy in the dead zone is shoved to exactly range 2 and killed', () => {
    let s = game();
    const bow = debugSpawn(s, 'redFletchBowman', 0, { col: 4, row: 4 });
    // NOT an Anchored body — Anchored is the deck's own counter, and using one here would
    // silently test nothing.
    // ⚠ Red Mark's OWN chaff, not a Wildgrowth body: borrowing another deck's card ties this
    // arithmetic to that deck's balance, and the 2026-08-08 Wildgrowth pass moved Thornfang to 35.
    const intruder = debugSpawn(s, 'arrowRunner', 1, { col: 4, row: 5 }); // adjacent = gun off

    expect(() => applyAction(s, { t: 'RangedAttack', unit: bow.id, target: intruder.pos }))
      .toThrow(/exactly 2 orthogonal tiles/);

    // "Fall Back!" is cast from the leader's tile (4,1), so it pushes DOWN-board, away from it.
    s.players[0].hand.push('fallBack');
    s.players[0].sp = 8;
    s = applyAction(s, { t: 'CastSpell', card: 'fallBack', targets: [intruder.pos] });
    expect(s.units[intruder.id]!.pos).toEqual({ col: 4, row: 6 }); // now exactly 2 away

    s = applyAction(s, { t: 'RangedAttack', unit: bow.id, target: { col: 4, row: 6 } });
    expect(s.units[intruder.id]).toBeUndefined();
    expect(s.units[bow.id]).toBeDefined(); // out of reach, so no strikeback
  });
});

describe('deck identity guards', () => {
  const defs = REDMARK_DECK.list.map((id) => REDMARK_DECK.cards[id]!);
  const units = defs.filter((d): d is UnitCardDef => d.kind === 'unit');

  it('keeps a real second rank — at least 5 Ranged bodies', () => {
    expect(units.filter((u) => u.keywords.includes('Ranged')).length).toBeGreaterThanOrEqual(5);
  });

  it('keeps a real front rank — at least 3 Anchored bodies', () => {
    expect(units.filter((u) => u.keywords.includes('Anchored')).length).toBeGreaterThanOrEqual(3);
  });

  it('fields more than one firing band, or "exact range" means nothing', () => {
    const bands = new Set(units.filter((u) => u.keywords.includes('Ranged')).map((u) => u.range ?? 1));
    expect(bands.size).toBeGreaterThanOrEqual(2);
  });

  it('named elites stay rare — no 3-of on a named veteran', () => {
    for (const named of ['serjeantKell', 'markedWardenTarr', 'vessaLongShot']) {
      expect(REDMARK_DECK.list.filter((c) => c === named).length).toBeLessThanOrEqual(2);
    }
  });

  it('the leader still shoots', () => {
    expect(REDMARK_DECK.leader.range).toBe(2);
  });
});

describe('rangedTargets on the deck bodies', () => {
  it('each shooter offers exactly its own band, orthogonally', () => {
    const s = game();
    for (const [card, want] of [['vergeSkirmisher', 1], ['redFletchBowman', 2], ['vessaLongShot', 3]] as const) {
      const u = debugSpawn(s, card, 0, { col: 4, row: 4 });
      const targets = rangedTargets(s, s.units[u.id]!);
      expect(targets.every((c) => c.col === 4 || c.row === 4)).toBe(true);
      for (const t of targets) {
        expect(Math.abs(t.col - 4) + Math.abs(t.row - 4)).toBe(want);
      }
      expect(targets.some((c) => sameCoord(c, { col: 4, row: 4 }))).toBe(false);
      delete s.units[u.id];
      s.board[3]![3]!.occupant = undefined;
    }
  });
});
