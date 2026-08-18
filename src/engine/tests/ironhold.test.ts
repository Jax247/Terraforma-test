// Ironhold — the starter / A/B-control deck, and the `InDefenseStance` condition it needed.
//
// The legality and legibility checks here are the tutorial-specific ones: a starter deck fails if
// its cards need a second reading, so the generated card text is asserted, not just the stats.

import { afterEach, describe, expect, it } from 'vitest';
import { makeBoard } from '../board';
import { COUNTER_STEP, conditionHolds, effectiveAtk, effectiveDef } from '../stats';
import { applyAction, debugSpawn, initGame } from '../engine';
import { describeCard, defaultResolver } from '../describe';
import {
  DECKS, DECK_CARDS, DECK_TOKENS, IRONHOLD_DECK, RHODAN,
  deckCost, validateCardRules, validateDeck, validateLeader, STANDARD_DC_CAP,
} from '../content/decks';
import { resetRules } from '../rules';
import type { CardDef, GameState, UnitCardDef } from '../types';

afterEach(() => resetRules());

function game(): GameState {
  return initGame({
    board: makeBoard(),
    cardDefs: DECK_CARDS,
    tokenDefs: DECK_TOKENS,
    players: [
      { leader: RHODAN, deck: [...IRONHOLD_DECK.list], fusionPool: [] },
      { leader: RHODAN, deck: [...IRONHOLD_DECK.list], fusionPool: [] },
    ],
  });
}

const units = (): UnitCardDef[] =>
  Object.values(IRONHOLD_DECK.cards).filter((c): c is UnitCardDef => c.kind === 'unit');

// ---------------------------------------------------------------------------
// The condition
// ---------------------------------------------------------------------------

describe('InDefenseStance', () => {
  it('is true only while the unit is braced', () => {
    const s = game();
    const u = debugSpawn(s, 'shieldbearer', 0, { col: 4, row: 4 });
    expect(conditionHolds(s, { k: 'InDefenseStance' }, { subject: u })).toBe(false);
    u.stance = 'defense';
    expect(conditionHolds(s, { k: 'InDefenseStance' }, { subject: u })).toBe(true);
  });

  it('is false for a leader, which can never brace', () => {
    const s = game();
    expect(conditionHolds(s, { k: 'InDefenseStance' }, { subject: s.units['leader0'] })).toBe(false);
  });

  it('gates Braced Pikeman\'s DEF — the payoff that makes bracing worth something', () => {
    const s = game();
    const u = debugSpawn(s, 'bracedPikeman', 0, { col: 4, row: 4 });
    s.board[3]![3]!.terrain = 'Normal';
    // effectiveDef reads the self-aura only while the condition holds.
    const attacking = effectiveDef(s, u);
    u.stance = 'defense';
    expect(effectiveDef(s, u)).toBe(attacking + 10);
  });
});

// ---------------------------------------------------------------------------
// "Breach the Line!" — the other half of the stance axis: what bracing COSTS.
// ---------------------------------------------------------------------------

describe('"Breach the Line!"', () => {
  /** Put a braced/standing enemy on the board and cast the spell at it. */
  function cast(stance: 'attack' | 'defense'): { s: GameState; target: string } {
    const s = game();
    const victim = debugSpawn(s, 'stoneSentinel', 1, { col: 4, row: 4 });
    victim.stance = stance;
    s.players[0].hand.push('breachTheLine');
    s.players[0].sp = 8;
    return { s: applyAction(s, { t: 'CastSpell', card: 'breachTheLine', targets: [victim.pos] }), target: victim.id };
  }

  it('destroys a braced enemy outright, whatever its stats', () => {
    const { s, target } = cast('defense');
    expect(s.units[target]).toBeUndefined();
    expect(s.players[1].graveyard).toContain('stoneSentinel');
  });

  it('fizzles against the same body standing up — the condition IS the counterplay', () => {
    const { s, target } = cast('attack');
    expect(s.units[target]).toBeDefined();
    // Spent either way: the card is gone and the answer was to not be braced.
    expect(s.players[0].graveyard).toContain('breachTheLine');
  });

  it('is real removal, not a damage threshold — it ignores effective ATK entirely', () => {
    // The whole reason this card exists. `Damage` destroys only when amount >= effectiveAtk, so
    // every other piece of removal in the pool silently whiffs on a big body. Stone Sentinel is a
    // 50-ATK level 5; no printed damage number in the game reaches it.
    const s = game();
    const victim = debugSpawn(s, 'stoneSentinel', 1, { col: 4, row: 4 });
    victim.stance = 'defense';
    expect(effectiveAtk(s, victim)).toBeGreaterThan(30); // above the DAMAGE_FLOOR
    s.players[0].hand.push('breachTheLine');
    s.players[0].sp = 8;
    const after = applyAction(s, { t: 'CastSpell', card: 'breachTheLine', targets: [victim.pos] });
    expect(after.units[victim.id]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Legality
// ---------------------------------------------------------------------------

describe('Ironhold is legal', () => {
  it('passes validateDeck — 40 cards, <=3 copies, within the DC cap', () => {
    expect(validateDeck(IRONHOLD_DECK)).toEqual([]);
    expect(IRONHOLD_DECK.list).toHaveLength(40);
    expect(deckCost(IRONHOLD_DECK)).toBeLessThanOrEqual(STANDARD_DC_CAP);
  });

  it('every card and the leader have only rules that can fire', () => {
    for (const def of Object.values(IRONHOLD_DECK.cards)) {
      expect(validateCardRules(def), def.id).toEqual([]);
    }
    expect(validateLeader(RHODAN)).toEqual([]);
  });

  it('is registered in DECKS', () => {
    expect(DECKS.map((d) => d.id)).toContain('ironhold');
  });
});

// ---------------------------------------------------------------------------
// The starter-deck properties — these ARE the design, so they are asserted
// ---------------------------------------------------------------------------

describe('Ironhold reads as a starter deck', () => {
  it('is built from few distinct cards, so a beginner sees the same ones repeatedly', () => {
    const distinct = new Set(IRONHOLD_DECK.list).size;
    expect(distinct).toBeLessThanOrEqual(15);
    // ...and most of them are 3-ofs rather than singletons.
    const counts = new Map<string, number>();
    for (const id of IRONHOLD_DECK.list) counts.set(id, (counts.get(id) ?? 0) + 1);
    expect([...counts.values()].filter((n) => n === 3).length).toBeGreaterThanOrEqual(10);
  });

  it('covers a clean curve from level 1 to 5', () => {
    const levels = new Set(units().map((u) => u.level));
    for (const l of [1, 2, 3, 4, 5]) expect(levels, `missing level ${l}`).toContain(l);
  });

  it('keeps its bodies stance-ambivalent — DEF at least 60% of ATK', () => {
    // THE axis: if DEF sat at the free default line (exactly 50% of ATK, per `unitDc`) the posture
    // would be a stat lookup, not a decision. A ratio rather than an absolute gap, because the
    // absolute version breaks at the top of the curve — a 50-ATK champion is a threat, not a wall,
    // and 50/35 is still a substantial body to attack into. For contrast, Piercer's glass bodies
    // run about 33%.
    for (const u of units()) {
      expect(u.def! / u.atk, `${u.id} ${u.atk}/${u.def}`).toBeGreaterThanOrEqual(0.6);
    }
  });

  it('keeps the text budget: at most 4 cards carry any rule at all', () => {
    const withText = Object.values(IRONHOLD_DECK.cards).filter(
      (c) => c.kind === 'unit' && c.rules.length > 0,
    );
    expect(withText.length).toBeLessThanOrEqual(4);
    // ...and none carries more than one line.
    for (const c of withText) {
      if (c.kind === 'unit') expect(c.rules.length, c.id).toBe(1);
    }
  });

  it('contains none of the advanced subsystems a beginner should not meet', () => {
    // Also what makes it a stable A/B control: few subsystems means few experiments perturb it.
    //
    // ⚠ TWO KEYWORDS ARE ALLOWED, added 2026-08-09, and the exemption is narrow on purpose. This
    // deck's axis is the brace/swing decision, and `Guard` and `Piercing` are the two halves of
    // exactly that: Guard makes holding a tile mean something (a brace you can walk around is not a
    // decision), and Piercing is the answer to a brace — the deck's own FIRST stated weakness,
    // which until now existed only in a probe deck. They are not "advanced subsystems a beginner
    // should not meet"; they are this deck's subject. Everything else on the banned list stays
    // banned, and the list is closed — a third keyword needs its own argument, not this one.
    const STANCE_KEYWORDS = new Set(['Guard', 'Piercing']);
    for (const c of Object.values(IRONHOLD_DECK.cards)) {
      expect(c.kind, `${c.id} is a trap`).not.toBe('trap');
      if (c.kind === 'unit') {
        expect(c.fusion, `${c.id} has fusion`).toBeUndefined();
        for (const k of c.keywords) {
          expect(STANCE_KEYWORDS.has(k), `${c.id} carries ${k}, which is not a stance keyword`).toBe(true);
        }
      }
      if (c.kind === 'spell') expect(c.ascension, `${c.id} is ascension`).toBeFalsy();
    }
    expect(IRONHOLD_DECK.fusionPool).toEqual([]);
    // No denial statuses anywhere in the deck.
    const denial = new Set(['Stunned', 'Snared', 'Disarmed', 'Suppressed']);
    for (const c of Object.values(IRONHOLD_DECK.cards)) {
      const lines = c.kind === 'unit' ? c.rules : c.kind === 'spell' ? c.effects : [];
      for (const l of lines) {
        if (l.effect.e === 'ApplyStatus') expect(denial.has(l.effect.status), c.id).toBe(false);
      }
    }
  });

  it('every card renders to a single short line of text', () => {
    // The tutorial legibility check. `describe.ts` output is what the GUI shows a player, so a
    // card whose text sprawls is a card a beginner will not read.
    const names = defaultResolver(DECK_CARDS, DECK_TOKENS);
    for (const c of Object.values(IRONHOLD_DECK.cards) as CardDef[]) {
      for (const line of describeCard(c, names)) {
        expect(line.length, `${c.id}: "${line}"`).toBeLessThanOrEqual(120);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// "Hold the Ford!" — the first card in the game that knows springs exist
// ---------------------------------------------------------------------------

describe('"Hold the Ford!"', () => {
  /** Find a spring tile on a default board. */
  function springTile(s: GameState): { col: number; row: number } {
    for (let col = 1; col <= 7; col++) {
      for (let row = 1; row <= 7; row++) {
        if (s.board[col - 1]![row - 1]!.spring) return { col, row };
      }
    }
    throw new Error('no spring on this board');
  }

  function cast(holdSpring: boolean): { s: GameState; id: string; before: number } {
    const s = game();
    const soldier = debugSpawn(s, 'ironholdVeteran', 0, { col: 1, row: 1 });
    if (holdSpring) debugSpawn(s, 'stonecutter', 0, springTile(s));
    const before = effectiveAtk(s, soldier);
    s.players[0].hand.push('holdTheFord');
    s.players[0].sp = 8;
    return { s: applyAction(s, { t: 'CastSpell', card: 'holdTheFord' }), id: soldier.id, before };
  }

  it('grows the line permanently while you hold a spring', () => {
    const { s, id, before } = cast(true);
    expect(effectiveAtk(s, s.units[id]!)).toBe(before + COUNTER_STEP);
    expect(s.units[id]!.atkCounters).toBe(1);
  });

  it('does nothing at all while you hold none — the objective IS the cost', () => {
    const { s, id, before } = cast(false);
    expect(effectiveAtk(s, s.units[id]!)).toBe(before);
    expect(s.units[id]!.atkCounters).toBe(0);
    expect(s.players[0].graveyard).toContain('holdTheFord'); // spent regardless
  });

  it('⚠ is caster-side: the ENEMY holding a spring does not turn it on', () => {
    // `HoldsSpring` reads `ctx.owner`, not the subject, so it asks about the CASTER's side. A
    // subject-side reading would have made this card fire off the opponent's objective, which is
    // the opposite of what it says.
    const s = game();
    const soldier = debugSpawn(s, 'ironholdVeteran', 0, { col: 1, row: 1 });
    debugSpawn(s, 'stonecutter', 1, springTile(s)); // THEIR unit on the spring
    const before = effectiveAtk(s, soldier);
    s.players[0].hand.push('holdTheFord');
    s.players[0].sp = 8;
    const after = applyAction(s, { t: 'CastSpell', card: 'holdTheFord' });
    expect(effectiveAtk(after, after.units[soldier.id]!)).toBe(before);
  });

  it('the growth is PERMANENT — it outlives the turn that bought it', () => {
    const { s, id, before } = cast(true);
    let cur = applyAction(s, { t: 'EndTurn' });
    cur = applyAction(cur, { t: 'EndTurn' });
    expect(effectiveAtk(cur, cur.units[id]!)).toBe(before + COUNTER_STEP);
  });
});
