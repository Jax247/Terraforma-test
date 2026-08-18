// Leader-piece survival edges surfaced by AI search rollouts (2026-07-17):
// leader-vs-leader strikeback and trigger-fired Destroy both used to call
// destroyUnit on a leader and crash. Working rulings (TODO(open), see engine.ts):
// strikeback chips the attacking leader's LP; a lenient Destroy fizzles.
import { describe, expect, it } from 'vitest';
import { applyAction, debugSpawn } from '../engine';
import { leaderOf, tileAt } from '../board';
import { effectiveAtk } from '../stats';
import { freshGame, teleport } from './helpers';
import type { SpellCardDef } from '../types';

describe('leader-vs-leader combat', () => {
  it('strikeback chips the attacking leader instead of destroying it', () => {
    const s = freshGame();
    const atkLeader = leaderOf(s, 0);
    const defLeader = leaderOf(s, 1);
    teleport(s, atkLeader.id, { col: defLeader.pos.col, row: defLeader.pos.row - 1 });

    const battleTile = defLeader.pos;
    const aEff = effectiveAtk(s, atkLeader, { role: 'attacker', battleTile, opponentId: defLeader.id });
    const dEff = effectiveAtk(s, defLeader, { role: 'defender', battleTile, opponentId: atkLeader.id });

    const after = applyAction(s, { t: 'Move', unit: atkLeader.id, to: battleTile });

    expect(after.players[1].leaderLife).toBe(s.players[1].leaderLife - aEff);
    expect(after.players[0].leaderLife).toBe(
      dEff >= aEff ? s.players[0].leaderLife - dEff : s.players[0].leaderLife,
    );
    // Both leader pieces survive; the pools took the hits.
    expect(leaderOf(after, 0)).toBeTruthy();
    expect(leaderOf(after, 1)).toBeTruthy();
  });
});

/**
 * ⚠ 2026-08-16, from playtest. A melee unit with 2+ movement that attacked a leader never moved:
 * the leader branch of `resolveCombat` does not advance (you cannot take a leader's tile), so the
 * unit chipped LP from wherever it stood — melee at a distance, which is what Ranged is for. It
 * now walks its route and stops in contact before striking.
 */
describe('a melee attacker closes on the leader before striking', () => {
  it('a 2-move unit two tiles away ends up beside the leader, not where it started', () => {
    const s = freshGame();
    const defLeader = leaderOf(s, 1);
    // Two tiles straight below the leader, with the tile between them empty.
    const start = { col: defLeader.pos.col, row: defLeader.pos.row - 2 };
    const contact = { col: defLeader.pos.col, row: defLeader.pos.row - 1 };
    tileAt(s.board, start).occupant = undefined;
    tileAt(s.board, contact).occupant = undefined;

    const u = debugSpawn(s, 'thornfang', 0, start);
    u.extraMove = 1; // move 2, so the leader is a legal destination
    u.sickTurns = 0;

    const lp0 = s.players[1].leaderLife;
    const after = applyAction(s, { t: 'Move', unit: u.id, to: defLeader.pos });

    expect(after.players[1].leaderLife).toBeLessThan(lp0); // the attack still happened
    expect(after.units[u.id]!.pos).toEqual(contact);       // ...and it travelled to make it
    expect(tileAt(after.board, contact).occupant).toEqual({ kind: 'unit', id: u.id });
    expect(tileAt(after.board, start).occupant).toBeUndefined();
    // The leader keeps its own tile — closing is not advancing onto it.
    expect(leaderOf(after, 1).pos).toEqual(defLeader.pos);
  });

  it('an already-adjacent attacker does not move', () => {
    const s = freshGame();
    const defLeader = leaderOf(s, 1);
    const contact = { col: defLeader.pos.col, row: defLeader.pos.row - 1 };
    tileAt(s.board, contact).occupant = undefined;

    const u = debugSpawn(s, 'thornfang', 0, contact);
    u.extraMove = 1;
    u.sickTurns = 0;

    const after = applyAction(s, { t: 'Move', unit: u.id, to: defLeader.pos });
    expect(after.units[u.id]!.pos).toEqual(contact);
  });
});

describe('leader steps onto a Destroy mine', () => {
  it('the Destroy fizzles against the leader and the mine is consumed', () => {
    const deathMine: SpellCardDef = {
      kind: 'spell', id: 'deathMine', name: 'Death Mine', dc: 1, scope: 'located',
      effects: [{ effect: { e: 'Destroy' }, target: { t: 'TriggeringUnit' } }],
    };
    const s = freshGame({ extraCards: { deathMine } });
    const leader = leaderOf(s, 0);
    const minePos = { col: leader.pos.col, row: leader.pos.row + 1 };
    s.setCards['sc1'] = {
      id: 'sc1', owner: 1, cardId: 'deathMine', kind: 'spell',
      pos: minePos, hasActed: false, setTurnCount: 0, stance: 'attack',
    };
    s.board[minePos.col - 1]![minePos.row - 1]!.occupant = { kind: 'set', id: 'sc1' };

    const after = applyAction(s, { t: 'Move', unit: leader.id, to: minePos });

    expect(leaderOf(after, 0)).toBeTruthy(); // leader survives the Destroy
    expect(after.setCards['sc1']).toBeUndefined(); // mine still one-shot
    expect(after.players[1].graveyard).toContain('deathMine');
  });
});
