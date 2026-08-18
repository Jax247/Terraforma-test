// Wildgrowth — sixth deck of the 2026-08 overhaul, rebuilt as THE BRAMBLE MAZE, and the first pass
// with a bring-it-down mandate.
//
// The two things it introduced are the FIRST uses of their vocabulary anywhere in the game:
// `PaintTerrain 'Wall'` and the `Wallwalk` keyword. Both are dangerous in ways no other content is —
// walls are PERMANENT (`RULES.wallsPaintable` is false, so nothing can ever clear one) and they can
// make a game unplayable. Most of this file is about the guard rails.
//
// ⚠ Every test here was mutation-tested: break the rule it covers and it must FAIL.
import { describe, expect, it } from 'vitest';
import { makeBoard, tileAt } from '../board';
import { applyAction, debugSpawn, initGame, legalActions } from '../engine';
import { effectiveAtk } from '../stats';
import { BRIAR_WILDSHEPHERD, WILDGROWTH_CARDS, WILDGROWTH_DECK } from '../content/decks/wildgrowth';
import { GRAVEMARCH_DECK } from '../content/decks/gravemarch';
import { POC_TOKENS } from '../content/poc';
import { endUntil } from './helpers';
import type { GameState, UnitCardDef } from '../types';

/** Wildgrowth (P0) on neutral ground, so no terrain muddies an ATK assertion. */
function game(): GameState {
  return initGame({
    board: makeBoard(() => 'Normal'),
    cardDefs: { ...WILDGROWTH_CARDS, ...GRAVEMARCH_DECK.cards },
    tokenDefs: POC_TOKENS,
    players: [
      { leader: BRIAR_WILDSHEPHERD, deck: [...WILDGROWTH_DECK.list], fusionPool: [...WILDGROWTH_DECK.fusionPool] },
      { leader: GRAVEMARCH_DECK.leader, deck: [...GRAVEMARCH_DECK.list], fusionPool: [...GRAVEMARCH_DECK.fusionPool] },
    ],
  });
}

describe('the maze grows out of what dies', () => {
  it('a thicket body paints a Wall on the tile it just vacated', () => {
    // `destroyUnit` fires OnDeath AFTER removal, from the death position — which is the only reason
    // a body can leave terrain behind at all. No new vocabulary was needed for this.
    let s = game();
    const shoot = debugSpawn(s, 'saplingSentry', 0, { col: 4, row: 4 }); // 25 ATK, leaves a thicket
    const killer = debugSpawn(s, 'graveTyrant', 1, { col: 4, row: 5 }); // 55 ATK, kills outright
    expect(tileAt(s.board, { col: 4, row: 4 }).terrain).toBe('Normal');

    s = endUntil(s, 1);
    s = applyAction(s, { t: 'Move', unit: killer.id, to: shoot.pos });
    expect(s.units[shoot.id]).toBeUndefined();
    expect(tileAt(s.board, { col: 4, row: 4 }).terrain).toBe('Wall');
  });

  it('and the killer cannot advance into the thicket it just made', () => {
    // ⚠ `advanceAfterKill` had NO wall check before this deck existed, so the attacker would have
    // been left standing inside impassable terrain — the one state the Wall rules exist to prevent.
    // The kill still stands; only the advance is denied.
    let s = game();
    const shoot = debugSpawn(s, 'saplingSentry', 0, { col: 4, row: 4 });
    const killer = debugSpawn(s, 'graveTyrant', 1, { col: 4, row: 5 });
    s = endUntil(s, 1);
    s = applyAction(s, { t: 'Move', unit: killer.id, to: shoot.pos });
    expect(s.units[killer.id]!.pos).toEqual({ col: 4, row: 5 }); // stayed put
    expect(s.log.some((l) => /cannot advance/.test(l))).toBe(true);
  });
});

describe('Wallwalk — the pack threads what the thicket leaves', () => {
  it('a Wallwalk body may enter a Wall; one without may not', () => {
    const s = game();
    tileAt(s.board, { col: 4, row: 4 }).terrain = 'Wall';
    const beast = debugSpawn(s, 'thornfang', 0, { col: 4, row: 3 });        // Wallwalk
    const plant = debugSpawn(s, 'saplingSentry', 0, { col: 3, row: 4 });    // no Wallwalk

    const canReach = (id: string) => legalActions(s)
      .some((a) => a.t === 'Move' && a.unit === id && a.to.col === 4 && a.to.row === 4);
    expect(canReach(beast.id), 'the pack goes through').toBe(true);
    expect(canReach(plant.id), 'the thicket does not').toBe(false);
  });

  it('the split is real: Beasts carry it, the Verdant thicket does not', () => {
    const units = [...new Set(WILDGROWTH_DECK.list)]
      .map((id) => WILDGROWTH_DECK.cards[id]!)
      .filter((d): d is UnitCardDef => d.kind === 'unit');
    const verdantWithWallwalk = units.filter((d) => d.type === 'Verdant' && d.keywords.includes('Wallwalk'));
    expect(verdantWithWallwalk.map((d) => d.id), 'the maze must cost its own builders').toEqual([]);
    expect(units.some((d) => d.type === 'Beast' && d.keywords.includes('Wallwalk'))).toBe(true);
  });
});

describe('⚠ the wall guard — walls are permanent and can make a game unplayable', () => {
  it('refuses a wall that would seal a leader in', () => {
    // P1's leader sits at (4,7); its ring is five tiles. Wall four, leave (4,6), and then kill a
    // Wildgrowth body standing in that last gap — the thicket it would leave is the one wall that
    // must never go down.
    let s = game();
    for (const c of [{ col: 3, row: 6 }, { col: 5, row: 6 }, { col: 3, row: 7 }, { col: 5, row: 7 }]) {
      tileAt(s.board, c).terrain = 'Wall';
    }
    const gap = { col: 4, row: 6 };
    const victim = debugSpawn(s, 'saplingSentry', 0, gap);
    const killer = debugSpawn(s, 'graveTyrant', 1, { col: 4, row: 5 });

    s = endUntil(s, 1);
    s = applyAction(s, { t: 'Move', unit: killer.id, to: gap });

    expect(s.units[victim.id], 'it still dies').toBeUndefined();
    expect(tileAt(s.board, gap).terrain, 'a leader must never be sealed in').not.toBe('Wall');
    expect(s.log.some((l) => /would seal the board/.test(l))).toBe(true);
  });

  it('lets an ordinary wall through — the guard is narrow, not a blanket refusal', () => {
    let s = game();
    const shoot = debugSpawn(s, 'saplingSentry', 0, { col: 4, row: 4 }); // mid-board, harmless
    const killer = debugSpawn(s, 'graveTyrant', 1, { col: 4, row: 5 });
    s = endUntil(s, 1);
    s = applyAction(s, { t: 'Move', unit: killer.id, to: shoot.pos });
    expect(tileAt(s.board, { col: 4, row: 4 }).terrain).toBe('Wall');
  });
});

describe('Briar no longer double-dips', () => {
  it('standing on Forest is worth +10, not +20', () => {
    // ⚠ THE WHOLE POINT OF THE PASS. Her old passive was "+10 to Beast/Verdant on Forest", which
    // STACKED with the terrain chart's own +10 — Thornfang printed 30 and fought at 50. The deck
    // measured 53.3 mean effective ATK against a field of 38.9.
    const s = game();
    const u = debugSpawn(s, 'thornfang', 0, { col: 4, row: 4 }); // 35 printed
    expect(effectiveAtk(s, s.units[u.id]!)).toBe(40); // 35 + Briar's flat +5, on Normal
    tileAt(s.board, { col: 4, row: 4 }).terrain = 'Forest';
    expect(effectiveAtk(s, s.units[u.id]!)).toBe(50); // +10 from the CHART only — no second helping
  });

  it('her passive is not terrain-shaped at all any more', () => {
    const passive = BRIAR_WILDSHEPHERD.rules.find((r) => r.trigger === 'Passive')!;
    expect(passive.target.t).not.toBe('FriendlyOfTypesOnTerrain');
    expect(passive.effect).toEqual({ e: 'AuraAtk', amount: 5 });
  });
});

describe('the deck reads as the axis it claims', () => {
  it('fields no range-1 Ranged — Skyrender was 0.02 shots a game', () => {
    const shooters = [...new Set(WILDGROWTH_DECK.list)]
      .map((id) => WILDGROWTH_DECK.cards[id]!)
      .filter((d): d is UnitCardDef => d.kind === 'unit')
      .filter((d) => d.keywords.includes('Ranged'));
    expect(shooters.map((d) => d.id)).toEqual([]);
  });

  it('enough bodies leave a thicket that the maze is the deck, not a card', () => {
    const wallers = WILDGROWTH_DECK.list
      .map((id) => WILDGROWTH_DECK.cards[id]!)
      .filter((d) => d.kind === 'unit'
        && d.rules.some((r) => r.trigger === 'OnDeath' && r.effect.e === 'PaintTerrain' && r.effect.terrain === 'Wall'));
    expect(wallers.length).toBeGreaterThanOrEqual(6);
  });
});
