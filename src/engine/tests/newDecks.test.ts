// Hivebrood & Dragonspire: first users of new rule shapes — a token-engine
// leader (StartOfTurn summon), a trap that summons, OnDeath SP ramp, a tribal
// end-of-turn anthem, and a leader active that is pure AoE removal.
import { describe, expect, it } from 'vitest';
import { applyAction, debugSpawn, isPinnedByGuard, isSick } from '../engine';
import { COUNTER_STEP, effectiveAtk } from '../stats';
import { leaderOf, mooreAdjacent, tileAt } from '../board';
import { BROOD_MATRON, DECK_CARDS, DECK_TOKENS, VHAROS } from '../content/decks';
import { freshGame } from './helpers';
import type { Coord, GameState, LeaderDef } from '../types';

function fresh(leaders?: [LeaderDef | undefined, LeaderDef | undefined]): GameState {
  return freshGame({ extraCards: DECK_CARDS, extraTokens: DECK_TOKENS, leaders });
}

function emptyRingTile(s: GameState, player: 0 | 1): Coord {
  const leader = leaderOf(s, player);
  const tile = mooreAdjacent(leader.pos).find((c) => !tileAt(s.board, c).occupant);
  if (!tile) throw new Error('no empty summon tile');
  return tile;
}

const swarmlings = (s: GameState, p: 0 | 1) =>
  Object.values(s.units).filter((u) => u.owner === p && u.isToken && u.cardId === 'swarmling');

describe('Brood Matron — token-engine leader', () => {
  it('spawns a Swarmling at the start of every own turn', () => {
    let s = fresh([BROOD_MATRON, undefined]);
    expect(swarmlings(s, 0).length).toBe(1); // init runs P1's first start-of-turn
    s = applyAction(s, { t: 'EndTurn' });
    s = applyAction(s, { t: 'EndTurn' });
    expect(swarmlings(s, 0).length).toBe(2);
  });

  it('Hatch pays 4 SP for two Swarmlings around the leader', () => {
    let s = fresh([BROOD_MATRON, undefined]);
    s.players[0].sp = 6;
    const before = swarmlings(s, 0).length;
    s = applyAction(s, { t: 'ActivateAbility' });
    expect(swarmlings(s, 0).length).toBe(before + 2);
    expect(s.players[0].sp).toBe(2);
  });

  it('tribal aura: +5 to Insects anywhere, none for others', () => {
    const s = fresh([BROOD_MATRON, undefined]);
    const drone = debugSpawn(s, 'frenziedDrone', 0, { col: 4, row: 4 });
    const offType = debugSpawn(s, 'mosshideBull', 0, { col: 2, row: 2 }); // Forest: +10 terrain only
    expect(effectiveAtk(s, drone)).toBe(30 + 5); // 30 ATK since the 2026-08-07 rebuild
    expect(effectiveAtk(s, offType)).toBe(45 + 10);
  });
});

describe('Hivebrood cards', () => {
  it('Brood Splitter dies into two Swarmlings', () => {
    let s = fresh();
    const splitter = debugSpawn(s, 'broodSplitter', 1, { col: 4, row: 4 });
    const bull = debugSpawn(s, 'mosshideBull', 0, { col: 4, row: 3 });
    s = applyAction(s, { t: 'Move', unit: bull.id, to: splitter.pos });
    expect(s.units[splitter.id]).toBeUndefined();
    expect(swarmlings(s, 1).length).toBe(2);
  });

  it('Swarm Call: +10 to every friendly Insect until end of turn', () => {
    let s = fresh();
    const drone = debugSpawn(s, 'frenziedDrone', 0, { col: 4, row: 4 });
    s.players[0].hand.push('swarmCall');
    const base = effectiveAtk(s, drone);
    s = applyAction(s, { t: 'CastSpell', card: 'swarmCall' });
    expect(effectiveAtk(s, s.units[drone.id]!)).toBe(base + 10);
    s = applyAction(s, { t: 'EndTurn' });
    expect(effectiveAtk(s, s.units[drone.id]!)).toBe(base); // anthem expired
  });

  it('Brood Hardening: an attack on the hive permanently grows the soldiers, not the chaff', () => {
    // Brood Matron so her StartOfTurn spawn puts a real Swarmling token on the board — the
    // LevelAtLeast gate is about level-0 bodies, and a token is the one that matters.
    let s = fresh([BROOD_MATRON, undefined]);
    const ring = emptyRingTile(s, 0);
    s.players[0].hand.push('broodHardening');
    s = applyAction(s, { t: 'SetCard', card: 'broodHardening', tile: ring });
    // Must be a body with NO OnDeath, or its own death spawns tokens and confuses the counts.
    const guard = debugSpawn(s, 'frenziedDrone', 0, { col: ring.col, row: ring.row + 1 });
    const bull = debugSpawn(s, 'mosshideBull', 1, { col: ring.col, row: ring.row + 2 });
    // A soldier out of the fight, so growth is read off a body that is certain to survive.
    const far = debugSpawn(s, 'broodTender', 0, { col: 1, row: 1 });
    const farAtk = effectiveAtk(s, far);
    const token = swarmlings(s, 0)[0];
    expect(token, 'Matron should have spawned a Swarmling at init').toBeDefined();
    const tokenAtk = effectiveAtk(s, token!);

    s = applyAction(s, { t: 'EndTurn' });
    s = applyAction(s, { t: 'Move', unit: bull.id, to: guard.pos });

    expect(s.players[0].graveyard).toContain('broodHardening'); // consumed
    expect(effectiveAtk(s, s.units[far.id]!)).toBe(farAtk + COUNTER_STEP);
    // The leader is level 0 and must NOT grow — Brood Matron's low ATK is the deck's anti-swarm
    // rating and this card is not allowed to erase it.
    const matron = Object.values(s.units).find((u) => u.owner === 0 && u.isLeader)!;
    expect(matron.atkCounters).toBe(0);
    // Tokens are level 0 too: chaff stays chaff, so the consumption axis keeps something to eat.
    expect(effectiveAtk(s, s.units[token!.id]!)).toBe(tokenAtk);
  });

  it('Brood Hardening is PERMANENT — it survives the turn cycle that expires an anthem', () => {
    let s = fresh([BROOD_MATRON, undefined]);
    const ring = emptyRingTile(s, 0);
    s.players[0].hand.push('broodHardening');
    s = applyAction(s, { t: 'SetCard', card: 'broodHardening', tile: ring });
    const guard = debugSpawn(s, 'frenziedDrone', 0, { col: ring.col, row: ring.row + 1 });
    // A second soldier out of the blast radius, so it survives to be measured across turns.
    const far = debugSpawn(s, 'broodTender', 0, { col: 1, row: 1 });
    const base = effectiveAtk(s, far);
    const bull = debugSpawn(s, 'mosshideBull', 1, { col: ring.col, row: ring.row + 2 });

    s = applyAction(s, { t: 'EndTurn' });
    s = applyAction(s, { t: 'Move', unit: bull.id, to: guard.pos });
    expect(effectiveAtk(s, s.units[far.id]!)).toBe(base + COUNTER_STEP);
    s = applyAction(s, { t: 'EndTurn' });
    s = applyAction(s, { t: 'EndTurn' });
    // ⚠ This is the whole point of counters over AtkMod: Swarm Call above expires here, this does not.
    expect(effectiveAtk(s, s.units[far.id]!)).toBe(base + COUNTER_STEP);
  });
});

describe('token cap — 5 per player, overflow fizzles', () => {
  it('spawns stop at the cap mid-batch and the source is still consumed', () => {
    // Matron's init spawn (1) + Sudden Hatch (3) = 4; Hatch wants 2, places only 1.
    let s = fresh([BROOD_MATRON, undefined]);
    s.players[0].sp = 9; // Sudden Hatch (3 SP) + Hatch (4 SP) + 2 left over
    s.players[0].hand.push('suddenHatch');
    s = applyAction(s, { t: 'CastSpell', card: 'suddenHatch' });
    expect(swarmlings(s, 0).length).toBe(4);
    s = applyAction(s, { t: 'ActivateAbility' });
    expect(swarmlings(s, 0).length).toBe(5); // capped: second Swarmling fizzled
    expect(s.players[0].sp).toBe(2); // Hatch still cost its 4 SP
  });

  it('the Matron start-of-turn engine refills only below the cap', () => {
    let s = fresh([BROOD_MATRON, undefined]);
    s.players[0].sp = 9; // Sudden Hatch (3 SP) + Hatch (4 SP)
    s.players[0].hand.push('suddenHatch');
    s = applyAction(s, { t: 'CastSpell', card: 'suddenHatch' });
    s = applyAction(s, { t: 'ActivateAbility' }); // at cap 5
    s = applyAction(s, { t: 'EndTurn' });
    s = applyAction(s, { t: 'EndTurn' }); // Matron's next start-of-turn spawn fizzles
    expect(swarmlings(s, 0).length).toBe(5);
    // Kill one token; the engine refills next turn.
    const victim = swarmlings(s, 0)[0]!;
    tileAt(s.board, victim.pos).occupant = undefined;
    delete s.units[victim.id];
    s = applyAction(s, { t: 'EndTurn' });
    s = applyAction(s, { t: 'EndTurn' });
    expect(swarmlings(s, 0).length).toBe(5);
  });

  it('the cap is per player — the opponent still spawns at your cap', () => {
    let s = fresh([BROOD_MATRON, undefined]);
    s.players[0].sp = 10;
    s.players[0].hand.push('suddenHatch', 'suddenHatch');
    s = applyAction(s, { t: 'CastSpell', card: 'suddenHatch' });
    s = applyAction(s, { t: 'ActivateAbility' }); // P0 at cap
    s = applyAction(s, { t: 'EndTurn' });
    s.players[1].sp = 10;
    s.players[1].hand.push('duneQueen'); // was swarmMother, cut in the 2026-08-08 Gravemarch rebuild
    s = applyAction(s, { t: 'Summon', card: 'duneQueen', tile: emptyRingTile(s, 1) });
    expect(Object.values(s.units).filter((u) => u.owner === 1 && u.isToken).length).toBe(2);
  });
});

describe('Vharos — Dragonspire', () => {
  it("Spirekeeper's Fury widens the margin — and the margin IS the damage", () => {
    // ⚠ REPLACES the Cataclysm Breath test. That ability (7 SP, Damage 20 in a 3x3) fired 0.03
    // times per game at greedy and 0.00 at Expert — at 7 SP against an 8 cap it ate a whole turn's
    // income. The rebuild swapped it for the deck's own verb: +20 ATK on the swing you were making.
    //
    // The point of the test is the SECOND assertion. Under combat overflow the pump is not just
    // reach, it is face damage: every point of ATK above the defender spills to their LP.
    let s = fresh([VHAROS, undefined]);
    const leader = leaderOf(s, 0);
    const mine = debugSpawn(s, 'cragWyrmling', 0, { col: leader.pos.col, row: leader.pos.row + 1 });
    const prey = debugSpawn(s, 'levyRecruit', 1, { col: leader.pos.col, row: leader.pos.row + 2 });
    s.players[0].sp = 8;

    const before = effectiveAtk(s, s.units[mine.id]!);
    s = applyAction(s, { t: 'ActivateAbility', targets: [mine.pos] });
    expect(effectiveAtk(s, s.units[mine.id]!), '+20 until end of turn').toBe(before + 20);
    expect(s.players[0].sp).toBe(3);

    // 20 printed + 20 pumped = 40, into a 20-ATK body: it dies and 20 spills.
    const lp = s.players[1].leaderLife;
    s = applyAction(s, { t: 'Move', unit: mine.id, to: prey.pos });
    expect(s.units[prey.id]).toBeUndefined();
    expect(s.players[1].leaderLife, 'the whole pump landed as overflow').toBe(lp - 20);
  });

  it('Cinder Whelp pins — the cheap half of pin-then-overrun', () => {
    // ⚠ REPLACES the Ember Egg test. The egg's OnDeath +2 SP paid into an account that is full
    // every turn (measured 7.7-7.8 of 8 for every deck), so it was cut for a body with a job.
    const s = fresh([VHAROS, undefined]);
    const whelp = debugSpawn(s, 'cinderWhelp', 0, { col: 4, row: 4 });
    const victim = debugSpawn(s, 'levyRecruit', 1, { col: 4, row: 5 });
    expect(isPinnedByGuard(s, s.units[victim.id]!)).toBe(true);
    expect(isPinnedByGuard(s, s.units[whelp.id]!), 'and it is not pinned by its own side').toBe(false);
  });

  it('Dragonfire removes a 25-or-less body anywhere', () => {
    let s = fresh();
    // Normal tile, no aura: 25 eff exactly. Was frenziedDrone until the 2026-08-07 rebuild took
    // it to 35 ATK, which no longer meets the spell's 25-or-less gate.
    const prey = debugSpawn(s, 'broodTender', 1, { col: 6, row: 3 });
    s.players[0].hand.push('dragonfire');
    s = applyAction(s, { t: 'CastSpell', card: 'dragonfire', targets: [prey.pos] });
    expect(s.units[prey.id]).toBeUndefined();
  });

  it('Sky Sovereign: level 7 is summonable at the SP cap and shoots without strikeback', () => {
    let s = fresh();
    s.players[0].sp = 8;
    s.players[0].hand.push('skySovereign');
    s = applyAction(s, { t: 'Summon', card: 'skySovereign', tile: emptyRingTile(s, 0) });
    const sov = Object.values(s.units).find((u) => u.cardId === 'skySovereign')!;
    expect(isSick(sov)).toBe(false); // sickness is 0 by default since 2026-08-01: it shoots on arrival
    const prey = debugSpawn(s, 'mosshideBull', 1, { col: sov.pos.col, row: sov.pos.row + 1 });
    s = applyAction(s, { t: 'RangedAttack', unit: sov.id, target: prey.pos });
    expect(s.units[prey.id]).toBeUndefined(); // 60 > 45
    expect(s.units[sov.id]).toBeDefined();
  });
});

describe('Pull It Down — removal that only works on the BIG', () => {
  /** Spawn an enemy, pump it to `atk` with counters, and try to Destroy it. */
  function tryKill(baseCard: string, counters: number): { s: GameState; id: string; before: number } {
    let s = fresh();
    const victim = debugSpawn(s, baseCard, 1, { col: 4, row: 4 });
    victim.atkCounters = counters;
    const before = effectiveAtk(s, victim);
    s.players[0].hand.push('pullItDown');
    s.players[0].sp = 8;
    s = applyAction(s, { t: 'CastSpell', card: 'pullItDown', targets: [victim.pos] });
    return { s, id: victim.id, before };
  }

  it('destroys a body at or above the 45 threshold', () => {
    const { s, id, before } = tryKill('ravenerPrime', 0); // 50 ATK
    expect(before).toBeGreaterThanOrEqual(45);
    expect(s.units[id]).toBeUndefined();
  });

  it('⚠ fizzles against a SMALL body — the inverse of every other removal card', () => {
    const { s, id, before } = tryKill('broodTender', 0); // 25 ATK
    expect(before).toBeLessThan(45);
    expect(s.units[id]).toBeDefined();
    expect(s.players[0].graveyard).toContain('pullItDown'); // spent either way
  });

  it('reads EFFECTIVE ATK, so buffs push a body INTO range', () => {
    // The counterplay, and the reason the threshold is not on printed ATK: a 30-ATK body is safe
    // until its controller pumps it, and then it is not. Three counters is +15 (COUNTER_STEP 5).
    const safe = tryKill('frenziedDrone', 0); // 30 ATK printed
    expect(safe.s.units[safe.id]).toBeDefined();
    const pumped = tryKill('frenziedDrone', 3); // 30 + 15 = 45
    expect(pumped.before).toBeGreaterThanOrEqual(45);
    expect(pumped.s.units[pumped.id]).toBeUndefined();
  });
});
