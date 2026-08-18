import { describe, expect, it } from 'vitest';
import { applyAction, debugSpawn } from '../../engine';
import { endUntil, freshGame } from '../../engine/tests/helpers';
import { DEFAULT_WEIGHTS } from '../evaluate';
import { makeGreedyPolicy, playGame, playTurn } from '../greedy';
import type { Action, Coord } from '../../engine';
import type { AiKnowledge } from '../sanitize';

const throwOnCandidateError = (a: Action, e: unknown) => {
  throw new Error(`candidate ${JSON.stringify(a)} threw: ${e instanceof Error ? e.message : e}`);
};

describe('greedy policy', () => {
  it('finds and takes a lethal attack', () => {
    const s = freshGame();
    s.players[1].leaderLife = 10;
    debugSpawn(s, 'mosshideBull', 0, { col: 4, row: 6 }); // 45 ATK next to the enemy leader at (4,7)
    const policy = makeGreedyPolicy({ onCandidateError: throwOnCandidateError });
    const first = policy(s, 0);
    expect(first).toEqual({ t: 'Move', unit: 'u1', to: { col: 4, row: 7 } });
    const done = playTurn(s, policy);
    expect(done.winner).toBe(0);
  });

  it('always terminates its turn within the action cap', () => {
    const policy = makeGreedyPolicy({ maxActionsPerTurn: 10, onCandidateError: throwOnCandidateError });
    const after = playTurn(freshGame(), policy);
    expect(after.active).toBe(1); // turn was passed
  });

  it('is deterministic: same state and options produce the same turn', () => {
    const run = () => playTurn(freshGame(), makeGreedyPolicy({ seed: 5, onCandidateError: throwOnCandidateError }));
    expect(run()).toEqual(run());
  });

  it("never summons into the leader's last escape tile", () => {
    // threatChipFrac 0 isolates the guard: with it on, greedy's best move is to
    // walk the leader away from the adjacent tyrants before it ever summons.
    const weights = { ...DEFAULT_WEIGHTS, threatChipFrac: 0 };
    const s = freshGame();
    // Enemy walls pin BRIAR at (4,1): orth neighbours (3,1) and (5,1) occupied,
    // so (4,2) is the last escape. Diagonal summon-zone tiles stay open.
    debugSpawn(s, 'graveTyrant', 1, { col: 3, row: 1 });
    debugSpawn(s, 'graveTyrant', 1, { col: 5, row: 1 });
    s.players[0].hand = ['thornfang'];
    s.players[0].sp = 10;
    const inner = makeGreedyPolicy({ weights, onCandidateError: throwOnCandidateError });
    const placedAt: Coord[] = [];
    const spy: typeof inner = (st, seat) => {
      const a = inner(st, seat);
      if (a.t === 'Summon' || a.t === 'SetCard') placedAt.push(a.tile);
      return a;
    };
    playTurn(s, spy);
    expect(placedAt.length).toBeGreaterThan(0); // it DID want to play the unit...
    expect(placedAt).not.toContainEqual({ col: 4, row: 2 }); // ...just not on the escape tile
  });

  it('summons into an escape tile freely while another remains', () => {
    const weights = { ...DEFAULT_WEIGHTS, threatChipFrac: 0 };
    const s = freshGame();
    debugSpawn(s, 'graveTyrant', 1, { col: 5, row: 1 }); // (3,1) stays open: two escapes
    s.players[0].hand = ['thornfang'];
    s.players[0].sp = 10;
    const inner = makeGreedyPolicy({ weights, onCandidateError: throwOnCandidateError });
    const placedAt: Coord[] = [];
    const spy: typeof inner = (st, seat) => {
      const a = inner(st, seat);
      if (a.t === 'Summon' || a.t === 'SetCard') placedAt.push(a.tile);
      return a;
    };
    playTurn(s, spy);
    // (4,2) is the aggression-gradient pick; with two escapes the guard must not veto it.
    expect(placedAt).toContainEqual({ col: 4, row: 2 });
  });

  it('defaults to fog: an unconfigured bot walks into an ambush a perfect-info bot dodges', () => {
    // P1 hides a 45-ATK body face-down beside a 20-ATK P0 unit. Attacking the card is suicide,
    // and a perfect-information bot can see that; a fogged one sees an inert unknown and takes
    // what looks like a free capture. The default must behave like the fogged one.
    const bait = { col: 4, row: 6 }; // inside P1's leader summon zone (leader at (4,7))
    let victim = '';
    const ambush = (knowledge?: AiKnowledge): Action => {
      let s = freshGame();
      s.players[1].hand = ['mosshideBull']; // 45 ATK
      s.players[1].sp = 10;
      s = applyAction(endUntil(s, 1), { t: 'SetCard', card: 'mosshideBull', tile: bait });
      s = endUntil(s, 0);
      s.players[0].hand = []; // nothing to play, so the ambush tile is the live question
      s.players[0].sp = 0;
      victim = debugSpawn(s, 'saplingSentry', 0, { col: 4, row: 5 }).id; // 20 ATK — loses the fight
      return makeGreedyPolicy(knowledge ? { knowledge } : {})(s, 0);
    };
    const fogged = ambush('fog');
    const onto = { t: 'Move', unit: victim, to: bait };
    expect(fogged).toEqual(onto);
    expect(ambush('perfect')).not.toEqual(onto);
    expect(ambush()).toEqual(ambush('fog')); // the default is fog
  });

  it('plays multi-turn stretches without any candidate errors (perfect and fog)', () => {
    for (const knowledge of ['perfect', 'fog'] as const) {
      const p0 = makeGreedyPolicy({ knowledge, onCandidateError: throwOnCandidateError });
      const p1 = makeGreedyPolicy({ knowledge, onCandidateError: throwOnCandidateError });
      const end = playGame(freshGame(), p0, p1, 10);
      expect(end.players[0].turnCount).toBeGreaterThanOrEqual(4);
    }
  });
});
