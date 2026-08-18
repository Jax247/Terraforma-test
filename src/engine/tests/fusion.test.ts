// Fusion, and the invariants that keep it from dying again.
//
// ⚠ THE MECHANIC WAS DEAD. On 2026-08-08 an instrumented sweep found **0 fusions across all 72
// ordered deck matchups** — every deck was carrying 3-4 DC of fusion pool that could never be spent.
// Two independent causes, either fatal on its own:
//
//   1. VALUATION. `evaluate.ts` scores a body as `unitAtk x effectiveAtk + unitLevel x level`, and
//      `unitLevel` exists to value "utility bodies beyond raw ATK — TOKENS ARE LEVEL 0". Every
//      fusion card in the game was printed `level: 0`, so a 70-ATK fused monster scored exactly like
//      a 10-ATK Husk. Of Apex Predator's -72 eval delta, 64 points were the level term alone.
//   2. OPPORTUNITY. Recipes named the decks' PREMIUM bodies, and both materials were simultaneously
//      on board only 8.0% of turns.
//
// The fix was one rule plus one rubric, and this file is what enforces them. A future deck pass that
// adds a fusion now has to make it worth doing.
import { describe, expect, it } from 'vitest';
import { makeBoard } from '../board';
import { applyAction, debugSpawn, initGame, legalActions } from '../engine';
import { DECKS } from '../content/decks';
import { WILDGROWTH_DECK } from '../content/decks/wildgrowth';
import { GRAVEMARCH_DECK } from '../content/decks/gravemarch';
import { POC_TOKENS } from '../content/poc';
import type { UnitCardDef } from '../types';

/** Every registered fusion, with its two materials resolved. */
const RECIPES = DECKS.flatMap((deck) =>
  deck.fusionPool.map((fid) => {
    const fused = deck.cards[fid] as UnitCardDef;
    const [a, b] = fused.fusion!.materials.map((id) => deck.cards[id] as UnitCardDef);
    const copies = (id: string) => deck.list.filter((x) => x === id).length;
    return { deck: deck.id, fused, a: a!, b: b!, copiesA: copies(a!.id), copiesB: copies(b!.id) };
  }),
);

describe('fusion invariants — every registered recipe', () => {
  it('there are recipes to check at all', () => {
    expect(RECIPES.length).toBeGreaterThanOrEqual(9);
  });

  for (const r of RECIPES) {
    const where = `${r.deck}/${r.fused.name}`;

    it(`${where}: level is the SUM of its materials' levels`, () => {
      // The bug fix, as an invariant. Summing makes the level term cancel exactly on a fuse, so the
      // bot's decision reduces to the honest question — is the fused ATK worth more than the two
      // bodies it ate? Any other value (especially 0) reintroduces a thumb on the scale.
      expect(r.fused.level, `${where} level`).toBe(r.a.level + r.b.level);
      expect(r.fused.level, `${where} must not read as a token`).toBeGreaterThan(0);
    });

    it(`${where}: prints more ATK than the bodies it consumes`, () => {
      // Fusing spends two cards, two board slots and the mover's action, and the fused body cannot
      // act the turn it forms. A recipe that does not even beat its own materials on raw ATK is
      // strictly worse than doing nothing — five of the ten were, before this pass.
      expect(r.fused.atk, `${where} ATK vs materials`).toBeGreaterThanOrEqual(r.a.atk + r.b.atk + 15);
    });

    it(`${where}: both materials are run at 2+ copies`, () => {
      // The opportunity floor. A recipe pointed at a 1-of is a recipe that never assembles.
      expect(r.copiesA, `${where} copies of ${r.a.id}`).toBeGreaterThanOrEqual(2);
      expect(r.copiesB, `${where} copies of ${r.b.id}`).toBeGreaterThanOrEqual(2);
    });
  }
});

describe('fusion scores as a GAIN to the evaluator', () => {
  it('every recipe is worth more after than before, on the shipping weights', async () => {
    const { DEFAULT_WEIGHTS: w } = await import('../../ai/evaluate');
    for (const r of RECIPES) {
      const before = w.unitAtk * (r.a.atk + r.b.atk) + w.unitLevel * (r.a.level + r.b.level);
      const after = w.unitAtk * r.fused.atk + w.unitLevel * r.fused.level;
      expect(after - before, `${r.deck}/${r.fused.name} eval delta`).toBeGreaterThan(0);
    }
  });
});

describe('a fusion actually resolves on the board', () => {
  /** Wildgrowth vs Gravemarch on neutral ground; P0 holds Apex Predator's materials. */
  function game() {
    return initGame({
      board: makeBoard(() => 'Normal'),
      cardDefs: { ...WILDGROWTH_DECK.cards, ...GRAVEMARCH_DECK.cards },
      tokenDefs: POC_TOKENS,
      players: [
        { leader: WILDGROWTH_DECK.leader, deck: [...WILDGROWTH_DECK.list], fusionPool: [...WILDGROWTH_DECK.fusionPool] },
        { leader: GRAVEMARCH_DECK.leader, deck: [...GRAVEMARCH_DECK.list], fusionPool: [...GRAVEMARCH_DECK.fusionPool] },
      ],
    });
  }

  it('moving one material onto the other consumes both and spawns the fused body', () => {
    let s = game();
    const fang = debugSpawn(s, 'thornfang', 0, { col: 3, row: 3 });
    const runner = debugSpawn(s, 'packRunner', 0, { col: 3, row: 4 });

    // The fuse is offered as an ordinary Move onto a friendly tile — the vault's "friendly mirror
    // of attack", not a separate action type.
    expect(legalActions(s).some((a) => a.t === 'Move' && a.unit === fang.id && a.to.col === 3 && a.to.row === 4)).toBe(true);

    s = applyAction(s, { t: 'Move', unit: fang.id, to: runner.pos });
    expect(s.units[fang.id]).toBeUndefined();
    expect(s.units[runner.id]).toBeUndefined();
    const fused = Object.values(s.units).find((u) => u.cardId === 'apexPredator');
    expect(fused, 'Apex Predator should be on the board').toBeDefined();
    expect(fused!.pos).toEqual({ col: 3, row: 4 }); // the stationary material's tile
    // Both materials are real cards, so both reach the graveyard.
    expect(s.players[0].graveyard).toContain('thornfang');
    expect(s.players[0].graveyard).toContain('packRunner');
    // Spent from the pool: it cannot be assembled twice.
    expect(s.players[0].fusionPool).not.toContain('apexPredator');
  });

  it('a non-recipe pair is NOT a legal move onto a friendly', () => {
    const s = game();
    const fang = debugSpawn(s, 'thornfang', 0, { col: 3, row: 3 });
    const bull = debugSpawn(s, 'mosshideBull', 0, { col: 3, row: 4 }); // the OLD material, no longer paired
    expect(legalActions(s).some((a) => a.t === 'Move' && a.unit === fang.id && a.to.col === bull.pos.col && a.to.row === bull.pos.row)).toBe(false);
  });

  // ⚠ ACTION INHERITANCE (2026-08-08). The fused body gets an action iff either material still had
  // one. On the move path the mover's is already spent — the move IS the fuse — so this reduces to
  // "had the stationary material acted yet?". Both branches are pinned below, because the rule is
  // the whole reason assembling is worth a turn.
  it('inherits the stationary material\'s unspent action, and can swing at once', () => {
    let s = game();
    const fang = debugSpawn(s, 'thornfang', 0, { col: 3, row: 3 });
    const runner = debugSpawn(s, 'packRunner', 0, { col: 3, row: 4 }); // fresh: has not acted
    debugSpawn(s, 'chitinChorister', 1, { col: 3, row: 5 });           // adjacent prey
    s = applyAction(s, { t: 'Move', unit: fang.id, to: runner.pos });
    const fused = Object.values(s.units).find((u) => u.cardId === 'apexPredator')!;
    expect(s.units[fused.id]!.hasActed).toBe(false);
    // ...and the action is real: it can attack the body waiting next to it.
    expect(legalActions(s).some((a) => a.t === 'Move' && a.unit === fused.id
      && a.to.col === 3 && a.to.row === 5)).toBe(true);
  });

  it('arrives INERT when the stationary material already spent its action', () => {
    let s = game();
    const fang = debugSpawn(s, 'thornfang', 0, { col: 3, row: 3 });
    const runner = debugSpawn(s, 'packRunner', 0, { col: 3, row: 4 });
    debugSpawn(s, 'chitinChorister', 1, { col: 3, row: 5 });
    s.units[runner.id]!.hasActed = true; // stands for "it already attacked this turn"
    s = applyAction(s, { t: 'Move', unit: fang.id, to: runner.pos });
    const fused = Object.values(s.units).find((u) => u.cardId === 'apexPredator')!;
    expect(s.units[fused.id]!.hasActed).toBe(true);
    expect(legalActions(s).some((a) => a.t === 'Move' && a.unit === fused.id)).toBe(false);
  });
});
