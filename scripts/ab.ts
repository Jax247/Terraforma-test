// Terraforma A/B self-play harness.
//
// Promotes the throwaway "loop playGame over seeds and diff two rule configs"
// scripts (combat overflow, GUARD, the SP economy pass, …) into one committed,
// reproducible command. Each experiment defines a CONTROL arm and a VARIANT arm;
// every arm plays greedy-vs-greedy self-play across the deck matchups × seeds,
// and the harness reports a deep per-game telemetry catalogue (kills by cause and
// victim type, LP by damage source, SP waste, board presence, game length, …)
// rolled up into distributions, with win-rate deltas carrying a ±95% CI.
//
// Two experiment shapes:
//   flag  — both arms share DECKS, differ only by a mutable engine config
//           (e.g. a RULES knob). Same matchup+seed both arms, so
//           paired outcome shifts are reported.
//   decks — arms differ by deck CONTENT (e.g. current 40/3 vs a trimmed 30/2
//           metagame). Measures how the whole metagame plays, not head-to-head.
//   weights — identical rules and decks; the arms' bots score positions with
//           different EvalWeights (e.g. fatigue-clock). Asks "does the game get
//           healthier when both bots think this way?", not "which bot is stronger".
//
// ⚠ TODO(2026-08-01): every A/B result recorded BEFORE deck shuffling was added (same date) was
// measured on fixed `list` order — `--seeds` varied only bot tie-jitter, so those games were not
// independent samples and cards low in a list were never drawn. Of the experiments still live,
// `maps` carries findings from that era and needs re-running before it is cited. Use
// `--no-shuffle` to reproduce an old run for comparison. See the README section of the same name.
//
// ⚠ TODO(2026-08-04): two-stat defense combat became a core rule and every deck now prints DEF,
// so EVERY per-deck number on record (the 2026-08-03 ladder included) predates the change and is
// stale. Re-run `ladder --single-arm` before citing any of it.
//
// Run:
//   npm run ab -- <experiment> [--seeds N] [--policy greedy|search|expert]
//                 [--matchups all|mirrors] [--max-turns N] [--no-shuffle] [--full]
//                 [--knowledge fog|perfect]
//                 [--json] [--csv FILE]
//   npm run ab -- deck-30-2 --seeds 30
//   npm run ab -- guard --seeds 20 --full

import { writeFileSync } from 'node:fs';

import {
  initGame,
  applyAction,
  makeArenaBoard,
  DECKS,
  DECK_CARDS,
  DECK_TOKENS,
  isPinnedByGuard,
  RULES_DEFAULTS,
  RULES,
  resetRules,
  setRules,
  BOARDS,
  boardById,
  boardFromLayout,
  mulberry32,
  shuffled,
  unitAt,
  chebyshev,
} from '../src/engine/index.ts';
import type { Action, GameState, PlayerId } from '../src/engine/index.ts';
import type { DeckDef } from '../src/engine/content/decks/index.ts';
import type { RulesConfig } from '../src/engine/index.ts';
import type { BoardDef } from '../src/engine/content/boards.ts';
import { ANVIL_DECK } from '../src/engine/content/decks/anvil.ts';
import { PIERCER_DECK } from '../src/engine/content/decks/piercer.ts';
import { MIXED_DECK } from '../src/engine/content/decks/mixed.ts';
import { makeGreedyPolicy } from '../src/ai/greedy.ts';
import type { Policy } from '../src/ai/greedy.ts';
import { DEFAULT_WEIGHTS } from '../src/ai/evaluate.ts';
import type { EvalWeights } from '../src/ai/evaluate.ts';
import type { AiKnowledge } from '../src/ai/sanitize.ts';
import { makeSearchPolicy } from '../src/ai/search.ts';
import type { SearchSettings } from '../src/ai/search.ts';
import { makeExpertPolicy } from '../src/ai/expert.ts';

const STARTING_LIFE = RULES_DEFAULTS.startingLife; // context only; deltas read live LP.
const TYPE_NAMES = [
  'Beast', 'Insect', 'Dragon', 'Avian', 'Aqua', 'Warrior', 'Spellcaster',
  'Fiend', 'Undead', 'Machine', 'Inferno', 'Verdant', 'Terra',
] as const;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

interface RunCfg {
  seeds: number;
  /**
   * First seed index. `--seeds 20 --seed-offset 40` plays seeds 40..59, which is what lets ONE
   * experiment be sharded across cores: the harness is single-threaded and a full ladder at
   * expert took 5 hours on one of twelve cores. Also the honest way to cross-check a ladder —
   * two experiments sharing a baseline control arm at the same seeds produce IDENTICAL games.
   */
  seedOffset: number;
  /**
   * Restrict matchups to those involving this deck (either seat). Deck work almost always asks
   * "how does X fare against the field", which is 14 of 64 ordered pairs at 8 decks — and the
   * pair count grows quadratically as the pool does.
   */
  focus?: string;
  /**
   * Skip the variant arm entirely and report the control against itself. For `ladder`, where both
   * arms are the shipping baseline, the variant run is pure waste.
   */
  singleArm: boolean;
  /**
   * Cheaper planning knobs for the search/expert tiers. DEFAULT ON, because every planning-tier
   * number on record was measured this way and full-strength is 270x greedy per game — a full
   * ladder at expert costs 5 hours. `--deep` opts back into the shipping bot settings.
   */
  fast: boolean;
  policy: 'greedy' | 'search' | 'expert';
  matchups: 'all' | 'mirrors';
  maxTurns: number;
  /**
   * Shuffle each deck from the per-game seed. ON by default since 2026-08-01 — before that
   * every game played its decks in literal `list` order, so `--seeds` varied only the bots'
   * tie-jitter and cards near the bottom of a list were never drawn at all. `--no-shuffle`
   * reproduces that old behaviour for comparison against pre-2026-08-01 numbers.
   */
  shuffle: boolean;
  /**
   * What the bots are allowed to see. 'fog' since 2026-08-02, matching the policies' own default
   * — a perfect-information bot dodges every trap, which quietly turns any trap-carrying deck
   * into a worse version of itself. `--knowledge perfect` reproduces pre-2026-08-02 runs.
   */
  knowledge: AiKnowledge;
  /** Maps every arm plays on, unless the arm names its own. Default: Arena only. */
  boards: BoardDef[];
  /**
   * RULES overrides applied to BOTH arms for the whole run — a background condition, not the
   * variable under test. Lets any experiment be re-asked under a different ruleset, e.g.
   * "does defense mode still stall if units can attack the turn they land?"
   */
  rules: Partial<RulesConfig>;
}

interface Arm {
  name: string;
  decks?: DeckDef[]; // defaults to DECKS
  boards?: BoardDef[]; // defaults to cfg.boards — set it to A/B the MAP itself
  setup?: () => void; // mutate mutable engine config before this arm's games
  teardown?: () => void; // restore it after
  /**
   * Eval weights BOTH bots in this arm play with. Defaults to DEFAULT_WEIGHTS. This is how an
   * evaluator change gets A/B'd at all: weights are policy options, not global engine config,
   * so a `setup` hook cannot reach them the way it reaches RULES or a flag.
   *
   * Same weights for both seats on purpose — the question these arms ask is "is the game
   * healthier when both bots think this way?", the same question the flag arms ask. Bot-vs-bot
   * strength (one arm's weights vs another's, head to head) is a different experiment shape and
   * this harness does not run it.
   */
  weights?: EvalWeights;
  /**
   * What this arm's bots may see. Defaults to `cfg.knowledge`. Only the `fog` experiment sets it
   * — every other experiment wants both arms looking at the board the same way.
   */
  knowledge?: AiKnowledge;
}

interface Experiment {
  name: string;
  describe: string;
  paired: boolean; // true iff both arms share the same deck set (flag experiments)
  control: Arm;
  variant: Arm;
}

// ---------------------------------------------------------------------------
// Per-game telemetry — accumulated during the instrumented game loop.
// `m` holds every additive metric under a namespaced key; scalar running state
// (peaks, first-blood, deck-out) folds into `m` at finalize.
// ---------------------------------------------------------------------------

/**
 * One completed turn, sampled at its EndTurn. The window of these at the end of a game is what
 * separates "the loser was still swinging when the deck ran out" from "both sides stopped
 * playing" — a fatigue count alone cannot tell those apart. See classifyEndgame.
 */
interface TurnRec {
  attacks: number;      // combat initiations (melee Move into an enemy, or RangedAttack)
  kills: number;        // non-token units removed during the turn
  actions: number;      // board actions taken (0 = a pass)
  contactDist: number;  // min chebyshev between opposing non-leader units (99 = one side empty)
  armyMin: number;      // units on the smaller of the two boards
}

interface Telemetry {
  m: Record<string, number>;
  firstBloodRound: number;
  largestHit: number;
  peakUnits: [number, number];
  boardSum: [number, number];
  boardSamples: number;
  deckOutRound: [number, number];
  curTurnBoardActions: number;
  curTurnAttacks: number;
  curTurnKills: number;
  turnRecs: TurnRec[];
}

interface GameResult {
  seatWinner: PlayerId | null; // null = stall (hit cap / no winner)
  deckIds: [string, string];
  boardId: string;
  metrics: Record<string, number>;
}

function inc(m: Record<string, number>, key: string, by = 1): void {
  m[key] = (m[key] ?? 0) + by;
}

function newTelemetry(): Telemetry {
  return {
    m: {},
    firstBloodRound: 0,
    largestHit: 0,
    peakUnits: [0, 0],
    boardSum: [0, 0],
    boardSamples: 0,
    deckOutRound: [0, 0],
    curTurnBoardActions: 0,
    curTurnAttacks: 0,
    curTurnKills: 0,
    turnRecs: [],
  };
}

function countUnits(s: GameState, owner: PlayerId): number {
  let n = 0;
  for (const u of Object.values(s.units)) if (!u.isLeader && u.owner === owner) n++;
  return n;
}

/** Closest opposing non-leader pair on the board; 99 when either side has nothing out. */
function contactDistance(s: GameState): number {
  const p0 = Object.values(s.units).filter((u) => !u.isLeader && u.owner === 0);
  const p1 = Object.values(s.units).filter((u) => !u.isLeader && u.owner === 1);
  if (p0.length === 0 || p1.length === 0) return 99;
  let best = 99;
  for (const a of p0) for (const b of p1) best = Math.min(best, chebyshev(a.pos, b.pos));
  return best;
}

/** A vanished unit's cause of death, or null when it should not count as a kill
 *  (leader piece, fusion material, or a token expiring at end of turn). */
function classifyKill(
  isLeader: boolean,
  isToken: boolean,
  ownerIsActive: boolean,
  action: Action,
  lines: string[],
): string | null {
  if (isLeader) return null; // leaders are never destroyed as pieces
  if (lines.some((l) => l.includes('fusion:')) && ownerIsActive) return null; // fused material
  switch (action.t) {
    case 'RangedAttack':
      return 'ranged';
    case 'Move':
      return 'melee';
    case 'CastSpell':
      return 'spell';
    case 'ActivateAbility':
      return 'ability';
    case 'FlipCard':
      return lines.some((l) => l.includes('trap ') && l.includes('fires')) ? 'trap' : 'spell';
    case 'EndTurn':
      return isToken ? null : 'other'; // token end-of-turn vanish is not a kill
    default:
      return 'other';
  }
}

const TURN_HDR = /player (\d) turn \d+ \(round \d+\): (\d+) SP/;
const OVERFLOW_LP = /(\d+) overflow to LP/;
const LEADER_HIT = /hits leader .* for (\d+)/;
const FATIGUE_LP = /(\d+) fatigue damage/;

/** Fold one applied action's before→after delta into the telemetry accumulator. */
function observe(tel: Telemetry, before: GameState, after: GameState, action: Action): void {
  const m = tel.m;
  const lines = after.log.slice(before.log.length);
  const activeSeat = before.active;

  // --- log-phrase event counters (robust, amount-carrying lines parsed below) ---
  let trapFiresThisAction = 0;
  for (const l of lines) {
    if (l.includes('captures the spring')) inc(m, 'misc.springCaptures');
    if (l.includes('token cap')) inc(m, 'misc.tokenFizzles');
    if (l.includes('ascends')) inc(m, 'misc.ascends');
    if (l.includes('terrain painted')) inc(m, 'misc.terrainPaints');
    if (l.includes('displaced to')) inc(m, 'misc.displacements');
    if (l.includes(' gains ')) inc(m, 'misc.keywordGains');
    if (l.includes('hits leader')) inc(m, 'misc.leaderHits');
    if (l.includes('strikeback') && l.includes('destroyed')) inc(m, 'misc.strikebackKills');
    if (l.includes('mutual destruction')) inc(m, 'kills.trades');
    if (l.includes('flanks with')) inc(m, 'kills.flankEvents');
    if (l.includes('fusion:')) inc(m, 'summon.fusions');
    if (l.includes('spell ') && l.includes('resolves')) inc(m, 'cards.spellsCast');
    if (l.includes('burns a card to the void')) inc(m, 'cards.handBurns');
    // Two-stat combat outcomes (see resolveDefenseCombat log lines).
    if (l.includes('defense broken')) inc(m, 'defense.wallsBroken');
    if (l.includes('wall holds')) inc(m, 'defense.wallsHeld');
    let mp = /pierces (\d+) to LP/.exec(l);
    if (mp) inc(m, 'defense.pierceLP', Number(mp[1]));
    mp = /(\d+) reflect to LP/.exec(l);
    if (mp) inc(m, 'defense.reflectLP', Number(mp[1]));
    mp = /failed break chips (\d+) to LP/.exec(l);
    if (mp) {
      inc(m, 'defense.failChipLP', Number(mp[1]));
      inc(m, 'defense.failedBreaks');
    }
    if (l.includes('takes a defense stance')) inc(m, 'defense.stanceSet');
    if (l.includes('trap ') && l.includes('fires')) {
      inc(m, 'cards.trapsFired');
      trapFiresThisAction++;
    }
    let mt = OVERFLOW_LP.exec(l);
    if (mt) inc(m, 'lp.overflow', Number(mt[1]));
    mt = LEADER_HIT.exec(l);
    if (mt) inc(m, 'lp.combatLeader', Number(mt[1]));
    mt = FATIGUE_LP.exec(l);
    if (mt) {
      inc(m, 'lp.fatigue', Number(mt[1]));
      inc(m, 'cards.fatigueDraws');
    }
    mt = TURN_HDR.exec(l);
    if (mt) inc(m, `econ.spEarnedP${mt[1]}`, Number(mt[2]));
  }
  if (trapFiresThisAction > 0) {
    m['cards.trapChainMax'] = Math.max(m['cards.trapChainMax'] ?? 0, trapFiresThisAction);
  }

  // --- LP deltas (source of truth for totals; sources attributed above) ---
  let hitThisAction = 0;
  for (const p of [0, 1] as const) {
    const d = before.players[p].leaderLife - after.players[p].leaderLife;
    if (d > 0) {
      inc(m, 'lp.total', d);
      hitThisAction += d;
      if (tel.firstBloodRound === 0) tel.firstBloodRound = after.round;
    }
    if (before.players[p].deck.length > 0 && after.players[p].deck.length === 0 && tel.deckOutRound[p] === 0) {
      tel.deckOutRound[p] = after.round;
    }
  }
  if (hitThisAction > tel.largestHit) tel.largestHit = hitThisAction;

  // --- deaths: attributes from the vanished Unit, cause from action + log ---
  const flanked = lines.some((l) => l.includes('flanks with'));
  for (const id of Object.keys(before.units)) {
    if (after.units[id]) continue;
    const u = before.units[id]!;
    const cause = classifyKill(u.isLeader, u.isToken, u.owner === activeSeat, action, lines);
    if (cause === null) continue;
    inc(m, `kills.cause.${cause}`);
    if (!u.isToken) tel.curTurnKills++;
    inc(m, u.isToken ? 'kills.tokens' : 'kills.total');
    inc(m, `kills.lossP${u.owner}`);
    if (!u.isToken) {
      inc(m, `kills.type.${u.type}`);
      inc(m, `kills.level.${u.level}`);
      if (flanked) inc(m, 'kills.flanked');
    }
  }

  // --- summons: appeared units ---
  for (const id of Object.keys(after.units)) {
    if (before.units[id]) continue;
    const u = after.units[id]!;
    if (u.isLeader) continue;
    inc(m, u.isToken ? 'summon.tokens' : 'summon.units');
    if (!u.isToken) inc(m, `summon.type.${u.type}`);
    if ((after.players[u.owner].graveyard.length) < (before.players[u.owner].graveyard.length)) {
      inc(m, 'summon.raises');
    }
  }

  // --- attack initiations: a ranged shot, or a Move onto a tile an enemy piece was standing on ---
  if (action.t === 'RangedAttack') {
    const t = unitAt(before, action.target);
    if (t && t.owner !== activeSeat) tel.curTurnAttacks++;
  } else if (action.t === 'Move') {
    const t = unitAt(before, action.to);
    if (t && t.owner !== activeSeat) tel.curTurnAttacks++;
  }

  // --- turn bookkeeping: pass detection, board sampling, SP waste ---
  if (action.t === 'EndTurn') {
    if (tel.curTurnBoardActions === 0) inc(m, 'len.passTurns');
    tel.turnRecs.push({
      attacks: tel.curTurnAttacks,
      kills: tel.curTurnKills,
      actions: tel.curTurnBoardActions,
      contactDist: contactDistance(before),
      armyMin: Math.min(countUnits(before, 0), countUnits(before, 1)),
    });
    tel.curTurnBoardActions = 0;
    tel.curTurnAttacks = 0;
    tel.curTurnKills = 0;
    const c0 = countUnits(before, 0);
    const c1 = countUnits(before, 1);
    tel.boardSum[0] += c0;
    tel.boardSum[1] += c1;
    tel.boardSamples++;
    tel.peakUnits[0] = Math.max(tel.peakUnits[0], c0);
    tel.peakUnits[1] = Math.max(tel.peakUnits[1], c1);
    inc(m, 'econ.spWasted', before.players[activeSeat].sp); // leftover, unspent
    // GUARD dosage. ⚠ A pin logs NOTHING — it silently removes destinations — so it can only be
    // sampled off the state. Without this the `guard` arm would be unfalsifiable in exactly the
    // way the retired vacuous version was: read this first, and if it is ~0 the balance Δ is noise.
    for (const u of Object.values(before.units)) {
      if (isPinnedByGuard(before, u)) inc(m, 'guard.pinned');
    }
  } else if (action.t !== 'BurnCard') {
    tel.curTurnBoardActions++;
  }
}

/** How many turns at the end of a game the endgame classifier looks at (≈5 rounds). */
const ENDGAME_WINDOW = 10;
/** Contact = opposing pieces within one step of threatening each other. */
const CONTACT_TILES = 2;
/** At/above this, the armies are still trading rather than posturing. */
const FIGHTING_ATTACKS_PER_TURN = 0.5;

/**
 * Label how a game was actually being played over its final turns. A fatigue win says the deck
 * ran out; it does not say whether that happened while the armies were grinding each other down
 * or while both bots sat still. Four shapes, checked in order:
 *
 *   fighting — attacks kept landing right up to the deck-out
 *   empty    — one side had (almost) nothing on board, so there was nothing to fight with
 *   deadlock — armies in contact but not swinging: a mutual stand-off nobody would break
 *   turtle   — armies out of contact and idle: both sides sat home and drew
 */
function classifyEndgame(recs: TurnRec[]): { label: string; stats: Record<string, number> } {
  const win = recs.slice(-ENDGAME_WINDOW);
  const n = win.length;
  if (n === 0) return { label: 'none', stats: {} };
  const mean = (fn: (r: TurnRec) => number): number => win.reduce((s, r) => s + fn(r), 0) / n;
  const stats = {
    attacksPerTurn: mean((r) => r.attacks),
    killsPerTurn: mean((r) => r.kills),
    contactPct: (win.filter((r) => r.contactDist <= CONTACT_TILES).length / n) * 100,
    passPct: (win.filter((r) => r.actions === 0).length / n) * 100,
    armyMin: mean((r) => r.armyMin),
  };
  let label: string;
  if (stats.attacksPerTurn >= FIGHTING_ATTACKS_PER_TURN) label = 'fighting';
  else if (stats.armyMin < 1) label = 'empty';
  else if (stats.contactPct >= 50) label = 'deadlock';
  else label = 'turtle';
  return { label, stats };
}

function finalize(tel: Telemetry, end: GameState, a: DeckDef, b: DeckDef, stalled: boolean): GameResult {
  const m = tel.m;
  m['len.rounds'] = end.round;
  m['len.turns'] = end.players[0].turnCount + end.players[1].turnCount;
  m['len.turnsP0'] = end.players[0].turnCount;
  m['len.turnsP1'] = end.players[1].turnCount;
  m['lp.largestHit'] = tel.largestHit;
  m['lp.firstBloodRound'] = tel.firstBloodRound;
  m['lp.effect'] = Math.max(
    0,
    (m['lp.total'] ?? 0) - (m['lp.overflow'] ?? 0) - (m['lp.combatLeader'] ?? 0) - (m['lp.fatigue'] ?? 0),
  );
  m['board.peakP0'] = tel.peakUnits[0];
  m['board.peakP1'] = tel.peakUnits[1];
  m['board.meanP0'] = tel.boardSamples ? tel.boardSum[0] / tel.boardSamples : 0;
  m['board.meanP1'] = tel.boardSamples ? tel.boardSum[1] / tel.boardSamples : 0;
  m['cards.deckOutRoundP0'] = tel.deckOutRound[0];
  m['cards.deckOutRoundP1'] = tel.deckOutRound[1];

  const earned = (m['econ.spEarnedP0'] ?? 0) + (m['econ.spEarnedP1'] ?? 0);
  const wasted = m['econ.spWasted'] ?? 0;
  m['econ.spEarned'] = earned;
  m['econ.spSpent'] = Math.max(0, earned - wasted);
  m['econ.wastePct'] = earned ? (wasted / earned) * 100 : 0;

  const seatWinner: PlayerId | null = !stalled && end.winner !== undefined ? end.winner : null;
  let cause = 'stall';
  if (seatWinner !== null) {
    const loser = seatWinner === 0 ? 1 : 0;
    cause = end.players[loser].deck.length === 0 && end.players[loser].fatigue > 0 ? 'fatigue' : 'leaderKill';
  }
  const eg = classifyEndgame(tel.turnRecs);
  for (const label of ['fighting', 'deadlock', 'turtle', 'empty']) {
    m[`endgame.${label}`] = eg.label === label ? 1 : 0;
  }
  for (const [k, v] of Object.entries(eg.stats)) m[`endgame.${k}`] = v;

  m['end.leaderKill'] = cause === 'leaderKill' ? 1 : 0;
  m['end.fatigue'] = cause === 'fatigue' ? 1 : 0;
  m['end.stall'] = cause === 'stall' ? 1 : 0;
  m['end.decisive'] = seatWinner !== null ? 1 : 0;
  m['win.seat0'] = seatWinner === 0 ? 1 : 0;
  m['win.seat1'] = seatWinner === 1 ? 1 : 0;

  return { seatWinner, deckIds: [a.id, b.id], metrics: m };
}

// ---------------------------------------------------------------------------
// Instrumented game runner (inlines playGame/playTurn to hook every action)
// ---------------------------------------------------------------------------

/**
 * Cheaper planning knobs, on by DEFAULT for the search/expert tiers (`--deep` opts out).
 *
 * Measured 2026-08-03: at the shipping settings a game costs 0.18s greedy, 8.8s search and 47.8s
 * expert — expert is 270x greedy, and a full 64-matchup ladder took FIVE HOURS. Every planning-tier
 * number already on record was measured at roughly these knobs anyway, so this is the historically
 * comparable setting as well as the affordable one. Use `--deep` when the QUESTION is bot strength.
 */
const FAST_SEARCH: Partial<SearchSettings> = {
  beamWidth: 4, maxPlanLength: 5, replyCandidates: 3, rolloutTurns: 1, timeBudgetMs: 800,
};
const FAST_NODE_BUDGET = 6000;

function makePolicy(
  seed: number,
  cfg: RunCfg,
  tel: Telemetry,
  weights?: EvalWeights,
  knowledge: AiKnowledge = cfg.knowledge,
): Policy {
  const onCandidateError = (): void => inc(tel.m, 'misc.candidateErrors');
  switch (cfg.policy) {
    // Expert carries its own support-term weights; an arm override replaces them wholesale, so
    // an arm that wants Expert scoring plus a tweak must spread EXPERT_WEIGHTS itself.
    case 'expert':
      return makeExpertPolicy({
        seed, onCandidateError, knowledge, ...(weights && { weights }),
        ...(cfg.fast ? { ...FAST_SEARCH, nodeBudget: FAST_NODE_BUDGET } : {}),
      });
    case 'search':
      return makeSearchPolicy({
        seed, onCandidateError, knowledge, ...(weights && { weights }),
        ...(cfg.fast ? FAST_SEARCH : {}),
      });
    default:
      return makeGreedyPolicy({ seed, onCandidateError, knowledge, ...(weights && { weights }) });
  }
}

function runGame(
  a: DeckDef,
  b: DeckDef,
  board: BoardDef,
  seed: number,
  cfg: RunCfg,
  weights?: EvalWeights,
  knowledge?: AiKnowledge,
): GameResult {
  // Deck order is part of the sample, not a constant: seeded so a paired experiment deals the
  // SAME two openings to both arms, while different seeds are genuinely different games.
  const order = (deck: DeckDef, n: number): string[] =>
    cfg.shuffle ? shuffled(deck.list, mulberry32(seed * 2 + n)) : [...deck.list];
  const start = initGame({
    board: boardFromLayout(board.layout),
    // Merge each deck's own card registry so unregistered probe decks (anvil/piercer) work.
    cardDefs: { ...DECK_CARDS, ...a.cards, ...b.cards },
    tokenDefs: DECK_TOKENS,
    players: [
      { leader: a.leader, deck: order(a, 1), fusionPool: [...a.fusionPool] },
      { leader: b.leader, deck: order(b, 2), fusionPool: [...b.fusionPool] },
    ],
  });
  const tel = newTelemetry();
  const p0 = makePolicy(seed * 2 + 1, cfg, tel, weights, knowledge ?? cfg.knowledge);
  const p1 = makePolicy(seed * 2 + 2, cfg, tel, weights, knowledge ?? cfg.knowledge);

  let cur = start;
  let turns = 0;
  while (cur.phase !== 'gameover' && turns < cfg.maxTurns) {
    const seat = cur.active;
    const policy = seat === 0 ? p0 : p1;
    for (let i = 0; i < 200; i++) {
      if (cur.phase === 'gameover') break;
      const action = policy(cur, seat);
      const after = applyAction(cur, action);
      observe(tel, cur, after, action);
      cur = after;
      if (action.t === 'EndTurn') break;
    }
    turns++;
  }
  return { ...finalize(tel, cur, a, b, cur.phase !== 'gameover'), boardId: board.id };
}

function enumerateMatchups(decks: DeckDef[], mode: 'all' | 'mirrors'): [DeckDef, DeckDef][] {
  const out: [DeckDef, DeckDef][] = [];
  for (const a of decks) for (const b of decks) {
    if (mode === 'mirrors' && a.id !== b.id) continue;
    out.push([a, b]);
  }
  return out;
}

function runArm(arm: Arm, cfg: RunCfg): GameResult[] {
  const decks = arm.decks ?? DECKS;
  const boards = arm.boards ?? cfg.boards;
  let matchups = enumerateMatchups(decks, cfg.matchups);
  if (cfg.focus) {
    matchups = matchups.filter(([a, b]) => a.id === cfg.focus || b.id === cfg.focus);
    if (matchups.length === 0) {
      console.error(`--focus '${cfg.focus}' matched no deck. Known: ${decks.map((d) => d.id).join(', ')}`);
      process.exit(1);
    }
  }
  const results: GameResult[] = [];
  arm.setup?.();
  try {
    // Board is the outermost loop so a paired experiment lines up game-for-game across arms.
    for (const board of boards) {
      for (const [a, b] of matchups) {
        for (let i = 0; i < cfg.seeds; i++) {
          const seed = cfg.seedOffset + i;
          results.push(runGame(a, b, board, seed, cfg, arm.weights, arm.knowledge));
        }
      }
    }
  } finally {
    arm.teardown?.();
  }
  return results;
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

interface Dist {
  total: number;
  mean: number;
  median: number;
  p10: number;
  p90: number;
  min: number;
  max: number;
  std: number;
}

function dist(vals: number[]): Dist {
  const n = vals.length;
  if (n === 0) return { total: 0, mean: 0, median: 0, p10: 0, p90: 0, min: 0, max: 0, std: 0 };
  const sorted = [...vals].sort((x, y) => x - y);
  const total = vals.reduce((x, y) => x + y, 0);
  const mean = total / n;
  const q = (p: number): number => sorted[Math.min(n - 1, Math.floor(p * n))]!;
  const variance = vals.reduce((x, y) => x + (y - mean) ** 2, 0) / n;
  return {
    total,
    mean,
    median: sorted[Math.floor(n / 2)]!,
    p10: q(0.1),
    p90: q(0.9),
    min: sorted[0]!,
    max: sorted[n - 1]!,
    std: Math.sqrt(variance),
  };
}

interface LadderRow {
  deckId: string;
  games: number;
  wins: number;
  winRate: number;
}

interface Agg {
  games: number;
  metrics: Record<string, Dist>;
  ladder: LadderRow[];
}

function aggregate(results: GameResult[]): Agg {
  const keys = new Set<string>();
  for (const r of results) for (const k of Object.keys(r.metrics)) keys.add(k);
  const metrics: Record<string, Dist> = {};
  for (const k of keys) metrics[k] = dist(results.map((r) => r.metrics[k] ?? 0));

  const ladder = new Map<string, { games: number; wins: number }>();
  const bump = (id: string, win: boolean): void => {
    const row = ladder.get(id) ?? { games: 0, wins: 0 };
    row.games++;
    if (win) row.wins++;
    ladder.set(id, row);
  };
  for (const r of results) {
    const winId = r.seatWinner === null ? null : r.deckIds[r.seatWinner];
    bump(r.deckIds[0], winId === r.deckIds[0]);
    bump(r.deckIds[1], winId === r.deckIds[1]);
  }
  const rows: LadderRow[] = [...ladder.entries()]
    .map(([deckId, v]) => ({ deckId, games: v.games, wins: v.wins, winRate: v.wins / v.games }))
    .sort((x, y) => y.winRate - x.winRate);

  return { games: results.length, metrics, ladder: rows };
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

const f = (n: number, dp = 1): string => n.toFixed(dp);
const pad = (s: string, w: number): string => s.padEnd(w);
const padL = (s: string, w: number): string => s.padStart(w);

/** ±95% CI half-width for two independent proportions; significant if |Δ|>it. */
function propDeltaCI(p1: number, n1: number, p2: number, n2: number): number {
  return 1.96 * Math.sqrt((p1 * (1 - p1)) / Math.max(1, n1) + (p2 * (1 - p2)) / Math.max(1, n2));
}

type Kind = 'mean' | 'rate' | 'median';
const val = (d: Dist | undefined, kind: Kind): number =>
  !d ? 0 : kind === 'rate' ? d.mean * 100 : kind === 'median' ? d.median : d.mean;

function reportLine(label: string, key: string, kind: Kind, c: Agg, v: Agg): string {
  const cv = val(c.metrics[key], kind);
  const vv = val(v.metrics[key], kind);
  const d = vv - cv;
  const suffix = kind === 'rate' ? '%' : '';
  const cs = f(cv) + suffix;
  const vs = f(vv) + suffix;
  const ds = (d >= 0 ? '+' : '') + f(d) + suffix;
  let sig = '';
  if (kind === 'rate') {
    const ci = propDeltaCI(cv / 100, c.games, vv / 100, v.games) * 100;
    sig = Math.abs(d) > ci ? '  *' : '  ·';
  }
  return `  ${pad(label, 26)}${padL(cs, 11)}${padL(vs, 11)}${padL(ds, 11)}${sig}`;
}

function printLadder(name: string, agg: Agg): void {
  console.log(`  ${name}`);
  for (const r of agg.ladder) {
    console.log(`    ${pad(r.deckId, 14)}${padL(f(r.winRate * 100), 6)}%   (${r.wins}/${r.games})`);
  }
}

/** Win rate per deck within one slice of results (used for the per-map ladder). */
function ladderOf(results: GameResult[]): { deckId: string; wins: number; games: number }[] {
  const tally = new Map<string, { wins: number; games: number }>();
  for (const r of results) {
    r.deckIds.forEach((id, seat) => {
      const t = tally.get(id) ?? { wins: 0, games: 0 };
      t.games += 1;
      if (r.seatWinner === seat) t.wins += 1;
      tally.set(id, t);
    });
  }
  return [...tally.entries()]
    .map(([deckId, t]) => ({ deckId, ...t }))
    .sort((a, b) => b.wins / b.games - a.wins / a.games);
}

const rate = (results: GameResult[], key: string): number =>
  results.length === 0 ? 0 : (results.reduce((n, r) => n + (r.metrics[key] ?? 0), 0) / results.length) * 100;
const avg = (results: GameResult[], key: string): number =>
  results.length === 0 ? 0 : results.reduce((n, r) => n + (r.metrics[key] ?? 0), 0) / results.length;

/**
 * Per-map breakdown. The A/B numbers above are pooled across maps, which hides the thing a map
 * pool exists to create: the same rule change landing differently on open ground than in a
 * chokepoint. This splits both arms by board.
 */
function printPerBoard(exp: Experiment, cRes: GameResult[], vRes: GameResult[]): void {
  const boardsOf = (rs: GameResult[]) => [...new Set(rs.map((r) => r.boardId))];
  const ids = [...new Set([...boardsOf(cRes), ...boardsOf(vRes)])];
  if (ids.length < 2) return;

  console.log('\n  — Per-map outcomes —');
  console.log(`    ${pad('map', 14)}${padL('seat-0 c', 10)}${padL('seat-0 v', 10)}${padL('fatigue c', 11)}${padL('fatigue v', 11)}${padL('rounds c', 10)}${padL('rounds v', 10)}`);
  for (const id of ids) {
    const c = cRes.filter((r) => r.boardId === id);
    const v = vRes.filter((r) => r.boardId === id);
    // An arm that never played this map prints "—" rather than a misleading 0.
    const cell = (rs: GameResult[], fn: (rs: GameResult[]) => number, suffix: string, w: number) =>
      padL(rs.length === 0 ? '—' : f(fn(rs)) + suffix, w);
    console.log(
      `    ${pad(id, 14)}` +
      cell(c, (r) => rate(r, 'win.seat0'), '%', 10) + cell(v, (r) => rate(r, 'win.seat0'), '%', 10) +
      cell(c, (r) => rate(r, 'end.fatigue'), '%', 11) + cell(v, (r) => rate(r, 'end.fatigue'), '%', 11) +
      cell(c, (r) => avg(r, 'len.rounds'), '', 10) + cell(v, (r) => avg(r, 'len.rounds'), '', 10),
    );
  }

  // Deck × map. Built from whichever arm actually spans the maps — in a `maps`-style experiment
  // the control is Arena-only, so reading the matrix off the control would print an empty grid.
  const source = boardsOf(vRes).length > boardsOf(cRes).length
    ? { rs: vRes, label: exp.variant.name }
    : { rs: cRes, label: exp.control.name };
  const mapIds = boardsOf(source.rs);
  const deckIds = [...new Set(source.rs.flatMap((r) => r.deckIds))];
  if (mapIds.length < 2 || deckIds.length < 2) return;

  console.log(`\n  — Deck win% by map (${source.label}) —`);
  console.log(`    ${pad('map', 14)}${deckIds.map((d) => padL(d.slice(0, 9), 11)).join('')}`);
  const winPct = (mapId: string, deckId: string): number | undefined => {
    const row = ladderOf(source.rs.filter((r) => r.boardId === mapId)).find((r) => r.deckId === deckId);
    return row ? (row.wins / row.games) * 100 : undefined;
  };
  for (const id of mapIds) {
    console.log(
      `    ${pad(id, 14)}` +
      deckIds.map((d) => {
        const v = winPct(id, d);
        return padL(v === undefined ? '—' : f(v) + '%', 11);
      }).join(''),
    );
  }
  // How much a deck's win rate MOVES across the pool: the map-sensitivity of each archetype.
  console.log(`    ${pad('SPREAD', 14)}` + deckIds.map((d) => {
    const vals = mapIds.map((id) => winPct(id, d)).filter((v): v is number => v !== undefined);
    return padL(vals.length < 2 ? '—' : f(Math.max(...vals) - Math.min(...vals)) + 'pp', 11);
  }).join(''));
}

/**
 * What the bots were doing over the last turns of a game, for all games and again for the
 * fatigue/deck-out subset. A rising fatigue rate is only a problem if those games were dead —
 * fatigue reached while both armies are still trading is just a long game.
 */
function printEndgameShape(cRes: GameResult[], vRes: GameResult[]): void {
  const labels = ['fighting', 'deadlock', 'turtle', 'empty'];
  const row = (label: string, c: GameResult[], v: GameResult[], key: string, kind: 'rate' | 'mean'): string => {
    const fn = kind === 'rate' ? rate : avg;
    const cv = fn(c, key);
    const vv = fn(v, key);
    const sfx = kind === 'rate' ? '%' : '';
    return `  ${pad(label, 26)}${padL(f(cv) + sfx, 11)}${padL(f(vv) + sfx, 11)}` +
      `${padL((vv - cv >= 0 ? '+' : '') + f(vv - cv) + sfx, 11)}`;
  };
  const block = (title: string, c: GameResult[], v: GameResult[]): void => {
    console.log(`\n  — ${title} (n: control ${c.length}, variant ${v.length}) —`);
    if (c.length === 0 && v.length === 0) {
      console.log('    (no games in this slice)');
      return;
    }
    for (const l of labels) console.log(row(l, c, v, `endgame.${l}`, 'rate'));
    console.log(row('attacks / turn', c, v, 'endgame.attacksPerTurn', 'mean'));
    console.log(row('kills / turn', c, v, 'endgame.killsPerTurn', 'mean'));
    console.log(row('turns in contact', c, v, 'endgame.contactPct', 'mean'));
    console.log(row('turns passed', c, v, 'endgame.passPct', 'mean'));
    console.log(row('smaller army (units)', c, v, 'endgame.armyMin', 'mean'));
  };

  const fatigued = (rs: GameResult[]): GameResult[] => rs.filter((r) => (r.metrics['end.fatigue'] ?? 0) === 1);
  block(`Endgame shape, all games (last ${ENDGAME_WINDOW} turns)`, cRes, vRes);
  block(`Endgame shape, FATIGUE games only`, fatigued(cRes), fatigued(vRes));
}

function printReport(exp: Experiment, cfg: RunCfg, ctrl: Agg, varr: Agg, cRes: GameResult[], vRes: GameResult[]): void {
  console.log(`\n=== A/B: ${exp.name} ===`);
  console.log(exp.describe);
  console.log(
    `policy=${cfg.policy}  knowledge=${cfg.knowledge}  shuffle=${cfg.shuffle ? 'on' : 'off'}` +
      `  matchups=${cfg.matchups}  seeds=${cfg.seeds}` +
      `  max-turns=${cfg.maxTurns}` +
      `  maps=${cfg.boards.map((b) => b.id).join(',')}  games/arm=${ctrl.games}` +
      (Object.keys(cfg.rules).length > 0
        ? `\n  RULES OVERRIDE (both arms): ${Object.entries(cfg.rules).map(([k, v]) => `${k}=${v}`).join('  ')}`
        : ''),
  );
  console.log(`\n  ${pad('metric', 26)}${padL('control', 11)}${padL('variant', 11)}${padL('Δ', 11)}`);

  console.log('\n  — Outcomes —');
  console.log(reportLine('seat-0 (1st) win rate', 'win.seat0', 'rate', ctrl, varr));
  console.log(reportLine('decisive %', 'end.decisive', 'rate', ctrl, varr));
  console.log(reportLine('stall %', 'end.stall', 'rate', ctrl, varr));
  console.log(reportLine('fatigue/deck-out %', 'end.fatigue', 'rate', ctrl, varr));

  console.log('\n  — Game length —');
  console.log(reportLine('rounds (mean)', 'len.rounds', 'mean', ctrl, varr));
  console.log(reportLine('rounds (median)', 'len.rounds', 'median', ctrl, varr));
  const cRnd = ctrl.metrics['len.rounds'];
  const vRnd = varr.metrics['len.rounds'];
  console.log(`  ${pad('rounds p10 / p90', 26)}${padL(`${f(cRnd?.p10 ?? 0)}/${f(cRnd?.p90 ?? 0)}`, 11)}${padL(`${f(vRnd?.p10 ?? 0)}/${f(vRnd?.p90 ?? 0)}`, 11)}`);
  console.log(reportLine('pass turns / game', 'len.passTurns', 'mean', ctrl, varr));

  console.log('\n  — Kills (per game) —');
  console.log(reportLine('units killed', 'kills.total', 'mean', ctrl, varr));
  console.log(reportLine('tokens killed', 'kills.tokens', 'mean', ctrl, varr));
  console.log(reportLine('trades (mutual)', 'kills.trades', 'mean', ctrl, varr));
  console.log(reportLine('flanked kills', 'kills.flanked', 'mean', ctrl, varr));
  for (const cause of ['melee', 'ranged', 'spell', 'trap', 'ability']) {
    console.log(reportLine(`  by ${cause}`, `kills.cause.${cause}`, 'mean', ctrl, varr));
  }

  console.log('\n  — Damage / LP (per game) —');
  console.log(reportLine('LP dealt total', 'lp.total', 'mean', ctrl, varr));
  for (const src of ['combatLeader', 'overflow', 'effect', 'fatigue']) {
    console.log(reportLine(`  ${src}`, `lp.${src}`, 'mean', ctrl, varr));
  }
  console.log(reportLine('largest single hit', 'lp.largestHit', 'mean', ctrl, varr));
  console.log(reportLine('first-blood round', 'lp.firstBloodRound', 'mean', ctrl, varr));

  // Two-stat combat became a core rule on 2026-08-04, so its telemetry belongs in the standard
  // report rather than in a defense-experiment block (there is no longer any such experiment).
  // `stance set` is the load-bearing one: if the bots never take a stance, DEF is decorative.
  console.log('\n  — Defense stance —');
  console.log(reportLine('stances taken / game', 'defense.stanceSet', 'mean', ctrl, varr));
  console.log(reportLine('walls held', 'defense.wallsHeld', 'mean', ctrl, varr));
  console.log(reportLine('walls broken', 'defense.wallsBroken', 'mean', ctrl, varr));
  console.log(reportLine('LP reflected', 'defense.reflectLP', 'mean', ctrl, varr));
  console.log(reportLine('LP pierced through', 'defense.pierceLP', 'mean', ctrl, varr));
  // Read this BEFORE any Guard balance number: ~0 means the arm carried no dosage.
  console.log(reportLine('unit-turns pinned', 'guard.pinned', 'mean', ctrl, varr));

  console.log('\n  — Economy / board —');
  console.log(reportLine('SP wasted / game', 'econ.spWasted', 'mean', ctrl, varr));
  console.log(reportLine('SP waste %', 'econ.wastePct', 'mean', ctrl, varr));
  console.log(reportLine('summons / game', 'summon.units', 'mean', ctrl, varr));
  console.log(reportLine('fusions / game', 'summon.fusions', 'mean', ctrl, varr));
  console.log(reportLine('mean board (P0)', 'board.meanP0', 'mean', ctrl, varr));
  console.log(reportLine('peak board (P0)', 'board.peakP0', 'mean', ctrl, varr));

  printEndgameShape(cRes, vRes);

  console.log('\n  — Per-deck win-rate ladder —');
  printLadder(`control (${exp.control.name})`, ctrl);
  printLadder(`variant (${exp.variant.name})`, varr);

  printPerBoard(exp, cRes, vRes);

  if (exp.paired && cRes.length === vRes.length) {
    let changed = 0;
    let cSeat0 = 0;
    let vSeat0 = 0;
    let cStall = 0;
    let vStall = 0;
    for (let i = 0; i < cRes.length; i++) {
      if (cRes[i]!.seatWinner !== vRes[i]!.seatWinner) changed++;
      if (cRes[i]!.seatWinner === 0) cSeat0++;
      if (vRes[i]!.seatWinner === 0) vSeat0++;
      if (cRes[i]!.seatWinner === null) cStall++;
      if (vRes[i]!.seatWinner === null) vStall++;
    }
    const n = cRes.length;
    console.log('\n  — Paired shifts (same matchup+seed both arms) —');
    console.log(`    outcome changed:  ${changed}/${n}  (${f((changed / n) * 100)}%)`);
    console.log(`    seat-0 wins:      control ${cSeat0} → variant ${vSeat0}  (net ${vSeat0 - cSeat0 >= 0 ? '+' : ''}${vSeat0 - cSeat0})`);
    console.log(`    stalls:           control ${cStall} → variant ${vStall}  (net ${vStall - cStall >= 0 ? '+' : ''}${vStall - cStall})`);
  }

  console.log('\n  * = win-rate Δ exceeds its ±95% CI (Wald); · = within noise.\n');
}

function printFull(ctrl: Agg, varr: Agg): void {
  const keys = new Set<string>([...Object.keys(ctrl.metrics), ...Object.keys(varr.metrics)]);
  console.log('\n  — Full catalogue (per-game mean, control | variant | Δ) —');
  for (const k of [...keys].sort()) {
    const cv = ctrl.metrics[k]?.mean ?? 0;
    const vv = varr.metrics[k]?.mean ?? 0;
    console.log(`  ${pad(k, 30)}${padL(f(cv, 2), 10)}${padL(f(vv, 2), 10)}${padL((vv - cv >= 0 ? '+' : '') + f(vv - cv, 2), 10)}`);
  }
}

function writeCsv(file: string, cRes: GameResult[], vRes: GameResult[]): void {
  const keys = new Set<string>();
  for (const r of [...cRes, ...vRes]) for (const k of Object.keys(r.metrics)) keys.add(k);
  const cols = [...keys].sort();
  const header = ['arm', 'deckA', 'deckB', 'winnerSeat', ...cols].join(',');
  const rows: string[] = [header];
  const emit = (arm: string, results: GameResult[]): void => {
    for (const r of results) {
      rows.push(
        [arm, r.deckIds[0], r.deckIds[1], r.seatWinner ?? 'stall', ...cols.map((k) => r.metrics[k] ?? 0)].join(','),
      );
    }
  };
  emit('control', cRes);
  emit('variant', vRes);
  writeFileSync(file, rows.join('\n'));
  console.log(`\nWrote ${cRes.length + vRes.length} per-game rows to ${file}`);
}

// ---------------------------------------------------------------------------
// Deck derivation + experiment registry
// ---------------------------------------------------------------------------

/** Derive a ≤`copies`-per-card, ≤`size`-card variant of a deck. Reduces each card
 *  to the copy cap (first-seen order), then trims single copies from the most-
 *  duplicated cards until at `size`. Keeps singleton tech, sheds redundancy. If a
 *  deck has fewer than `size` cards after the copy cap it stays below `size`
 *  (can't invent filler) — the resulting size is reported. */
function trimDeck(deck: DeckDef, size: number, copies: number): DeckDef {
  const counts = new Map<string, number>();
  const capped: string[] = [];
  for (const id of deck.list) {
    const c = counts.get(id) ?? 0;
    if (c < copies) {
      capped.push(id);
      counts.set(id, c + 1);
    }
  }
  while (capped.length > size) {
    const cur = new Map<string, number>();
    for (const id of capped) cur.set(id, (cur.get(id) ?? 0) + 1);
    let best: string | null = null;
    let bestN = 0;
    for (const [id, nn] of cur) if (nn > bestN) {
      bestN = nn;
      best = id;
    }
    if (best === null) break;
    capped.splice(capped.lastIndexOf(best), 1);
  }
  return { ...deck, list: capped };
}

/**
 * RETIRED EXPERIMENTS (cut 2026-08-03). Kept as a record so nobody re-adds them blind — the
 * value was the verdict, not the code. Restore from git history if a rule changes underneath one.
 *
 *   guard              ⚠ VACUOUS, never produced a real result. It only flips
 *                      GUARD_EXPERIMENT.enabled, but NO card in any deck carries the `Guard`
 *                      keyword, so the flag has nothing to act on: 0/3840 greedy, 0/384 search,
 *                      0/192 expert outcome changes with every metric Δ +0.00. The old scratchpad
 *                      version injected the keyword onto each deck's cheapest/biggest body; the
 *                      committed one lost that step. Needs Guard-carrying CARDS before it means
 *                      anything.
 *   sp-curve           DECIDED, ADOPTED (2026-08-09). `spStep` 3 -> 1, so the curve is 4/5/6/7/8
 *                      and the top end arrives on turn 5 instead of turn 3. Adopted for FEEL: the
 *                      old curve FINISHED on turn 3, leaving the economy a non-factor for 10 of a
 *                      13-round game. Measured balance-neutral over 1620 games/arm — every
 *                      per-deck delta inside ±5pp, spread 51.1 -> 51.9pp — and health-neutral or
 *                      better (stalls 0%, fatigue 2.2% -> 2.0%, decisive 100%, rounds 13.0 ->
 *                      13.7). The first 6+ SP body moves round 3.4 -> 5.3 while 6+ bodies PLAYED
 *                      per game holds at 2.86: delayed, not suppressed.
 *                      ⚠ `spStep: 2` is a trap — 4+2+2 = 8, still turn 3, changes nothing.
 *                      ⚠ EVERY A/B NUMBER RECORDED BEFORE 2026-08-09 WAS MEASURED ON 4/7/8.
 *                      To reproduce an old baseline, set `spStep: 3` (tests use
 *                      `withLegacySpCurve()`).
 *   sp-curve-slow      DECIDED, NOT ADOPTED. `3/1` (top end on turn 6). Read 46.3pp spread against
 *                      the 51.1pp baseline, but that came from gravemarch 78.3 -> 76.9 and ironhold
 *                      27.2 -> 30.6, each individually within noise — and the two mechanisms
 *                      proposed for it were both falsified (see the sp-accrual entry's note style).
 *                      ⚠ Do not cite it as a compression lever. 4/1 was taken instead as the
 *                      lighter change with the same feel benefit.
 *   sp-accrual         DECIDED, NOT ADOPTED (2026-08-09) — and the verdict is worth more than the
 *   sp-accrual-deep    code was. Tested: SP banking at a flat 3/turn instead of the shipping
 *                      refresh (4/7/8, unspent evaporates). ⚠ FIRST, `-deep` (cap 20) came back
 *                      BYTE-IDENTICAL to cap 8 — the bots never bank. With the cap at 20 the most
 *                      SP ever held at turn start was 7, and 90.5% of turns started at exactly the
 *                      income; Expert was the same (max 6), so it is not a search-depth problem.
 *                      An eval term for it (`spSaving`, also reverted) lifted 6+ SP bodies played
 *                      only 0.17 -> 0.30 a game against 3.33 under refresh, because a LINEAR bonus
 *                      for holding SP cannot express three turns of abstinence.
 *                      ⚠ THE REAL FINDING: it is not the bot. Refresh hands a full allowance every
 *                      turn regardless of last turn's spend, so every turn is an independent shot
 *                      at an 8-cost; accrual makes every purchase compete across time. Sweeping
 *                      income 3/4/5/6 with cap 20 gave 6+ bodies played 0.17/0.53/0.80/1.30 —
 *                      even at DOUBLE the proposed income, 60% below refresh, with 59-76% of turns
 *                      spent holding a bomb that cannot be paid for. A pool costed for refresh
 *                      cannot move onto accrual; the top end would have to be re-costed 7-8 -> ~4-5
 *                      POOL-WIDE. Revisit only alongside that re-cost. Vault: Open Threads.
 *   deck-30-2          DECIDED. 40/3 stays. Reconfirmed 2026-08-03: fatigue 0.4% → 13.1%*, which
 *                      is the deck-out rise the user declined the change over in July.
 *   fog                DECIDED, ADOPTED. Fog is the shipping default. Changes 13.5% of individual
 *                      games but balance is null (−1.1%, ns): it changes GAMES, not BALANCE.
 *   fatigue-clock      DECIDED, ADOPTED ON for all tiers. Correctly neutral at 40 cards
 *                      (10.9% of outcomes move, win-rate −0.2% ns) — which is the design intent.
 *   fatigue-clock-static  Sub-variant of the above; parent settled.
 *   clock-push         DECIDED, stays OFF. Measured null three times, most recently 0.8% of
 *                      outcomes at 1920 paired games.
 *   defense-piercing   UNANSWERABLE by self-play. buff vs atk differ by 2.5% of outcomes and only
 *                      in LP attribution. SETTLED ON FEEL 2026-08-04, as the verdict advised:
 *                      Piercing converts overkill to LP and reduces no DEF (ignoreFrac 0).
 *   defense-overflow   FALSIFIED TWICE (0/160, then 1/160). The non-piercing wall-break branch is
 *                      one bots essentially never take, so rewarding it cannot move anything.
 *                      Ratified at 0 — a non-piercing break concedes no LP.
 *   defense-failchip / -25  Near-null (2.5%) at both doses. Ratified at 0.
 *
 * CUT 2026-08-04 when two-stat combat was promoted out of DEFENSE_EXPERIMENT into the core
 * rules. All six flipped a flag that no longer exists, so both arms became identical:
 *   defense, defense-mixed, defense-field   Their question ("is the game healthy with defense
 *                      on?") is now just "is the game healthy", which is what `ladder` and the
 *                      replacement `defense-gauntlet` measure.
 *   defense-fatigue-clock / -mixed, defense-clock-push   Both measured NULL against the anvil
 *                      mirror. The stall there is a STANCE-LOCK no eval term pricing position
 *                      can reach; it needs a rules or content answer, not a weights one.
 */
function buildExperiments(): Map<string, Experiment> {
  const exps = new Map<string, Experiment>();

  const trimmed = DECKS.map((d) => trimDeck(d, 30, 2));
  // Deck depth (2026-08-02). A WEIGHTS experiment, not a flag one: the rules are identical in
  // both arms, only what the bots see changes. Control is the pre-2026-08-02 evaluator (both
  // deck-depth terms zeroed), so the control arm reproduces every earlier greedy baseline.
  const noFatigueClock: EvalWeights = { ...DEFAULT_WEIGHTS, fatigueFrac: 0, desperationPush: 0 };
  // STRESS PROBE for the same terms. At 40 cards a greedy game (median 14 rounds) almost never
  // reaches the horizon, so `fatigue-clock` measures mostly the null case — 1.4% of its games
  // ended on fatigue. Trimming to 18 cards makes the clock the dominant endgame instead, which
  // is the regime the terms were written for. NOT a proposed ruleset: 40/3 stands (user decision
  // 2026-07-20), this is a magnifying glass, and both arms play the same trimmed decks.
  const shortDecks = DECKS.map((d) => trimDeck(d, 18, 3));
  exps.set('fatigue-clock-short', {
    name: 'fatigue-clock-short',
    describe: 'Deck-depth terms OFF vs ON on 18-card decks — the deck-out endgame, magnified.',
    paired: true,
    control: { name: 'no deck-depth (18c)', decks: shortDecks, weights: noFatigueClock },
    variant: { name: 'deck-depth on (18c)', decks: shortDecks, weights: DEFAULT_WEIGHTS },
  });
  // Defense-mode prototype: both arms play the anvil-vs-piercer probe gauntlet.
  const defenseDecks = [ANVIL_DECK, PIERCER_DECK];

  // The two-stat probe gauntlet, on the shipping ruleset. Defense stopped being a flag on
  // 2026-08-04, so the six paired defense/* experiments that flipped it are gone (verdicts in
  // the RETIRED block above) — what survives is the need to keep WATCHING the wall matchups,
  // because the anvil mirror is where the stance-lock lives. No rules change: pair it with
  // --single-arm and read it as a ladder over the DEF-heavy decks.
  exps.set('defense-gauntlet', {
    name: 'defense-gauntlet',
    describe: 'No rules change — anvil/piercer/mixed on the shipping ruleset. Use with --single-arm.',
    paired: true,
    control: { name: 'baseline', decks: [ANVIL_DECK, PIERCER_DECK, MIXED_DECK] },
    variant: { name: 'baseline', decks: [ANVIL_DECK, PIERCER_DECK, MIXED_DECK] },
  });

  /**
   * GUARD, rebuilt 2026-08-09 with REAL DOSAGE.
   *
   * ⚠ The retired version of this experiment reported 0/3840 outcome changes and every metric Δ at
   * +0.00, and that null meant NOTHING: it only flipped `GUARD_EXPERIMENT.enabled`, and no card in
   * any deck carried the keyword, so the flag had nothing to act on. The verdict block below still
   * records it as vacuous. Do not repeat the mistake — an experiment must change what is PLAYED.
   *
   * Guard is no longer a flag at all (the 2026-08-09 re-spec made the pin a shipping movement rule
   * that gates itself: no card, no effect). So this is a DECKS experiment. The variant stamps Guard
   * onto the beefiest body in every deck — one card per deck, the natural home for "you cannot walk
   * past me" — and the control is the same decks untouched. The delta is the keyword's dosage.
   *
   * Read `pins held / game` first: if that is ~0 the arm is vacuous again and the balance number
   * is noise, exactly as before.
   */
  const withGuard = (d: DeckDef): DeckDef => {
    const units = [...new Set(d.list)]
      .map((id) => d.cards[id])
      .filter((c): c is UnitCardDef => c?.kind === 'unit' && !c.keywords.includes('Guard'));
    if (units.length === 0) return d;
    const beefiest = units.reduce((a, b) => (b.def ?? 0) > (a.def ?? 0) ? b : a);
    return {
      ...d,
      cards: {
        ...d.cards,
        [beefiest.id]: { ...beefiest, keywords: [...beefiest.keywords, 'Guard' as const], dc: beefiest.dc + 1 },
      },
    };
  };
  exps.set('guard', {
    name: 'guard',
    describe: 'Guard (pin) on one body per deck vs none — the dosage the retired vacuous version never had.',
    paired: true,
    control: { name: 'no Guard cards' },
    variant: { name: 'Guard on the beefiest body', decks: DECKS.map(withGuard) },
  });

  // Does the map pool change the game relative to the standard map? Both arms are baseline
  // rules and the full deck registry — the ONLY difference is the ground they play on, so any
  // delta is the map layer alone. The per-map tables under the report carry the detail.
  exps.set('maps', {
    name: 'maps',
    describe: 'Arena only (control) vs the whole built-in map pool (variant), baseline rules and decks.',
    paired: false,
    control: { name: 'Arena only', boards: [boardById('arena')!] },
    variant: { name: 'full map pool', boards: [...BOARDS] },
  });

  // Do the defense-stance eval terms (2026-08-04) make the bots actually use the stance, and does
  // the game stay healthy when they do? A WEIGHTS experiment: identical rules and decks, only the
  // evaluator differs, so the control arm reproduces every pre-2026-08-04 greedy baseline. Read
  // `stances taken / game` and `walls held` first — the balance delta is the second question.
  const noWallTerms: EvalWeights = { ...DEFAULT_WEIGHTS, wallDenyFrac: 0, wallReflectFrac: 0 };
  exps.set('stance', {
    name: 'stance',
    describe: 'Defense-stance eval terms OFF vs ON — does the bot use the stance, and is the game still healthy?',
    paired: true,
    control: { name: 'stance blind', weights: noWallTerms },
    variant: { name: 'deny+reflect priced', weights: DEFAULT_WEIGHTS },
  });

  // Dose check on the deny half. The first `stance` run bought stance usage (0.6 -> 9.3 per game)
  // at the cost of +3.5 rounds and a 0.6% -> 5.3% fatigue rise, because denying overflow takes LP
  // out of the game and something has to put it back. Half dose asks whether the behaviour
  // survives at a cheaper price.
  const halfDeny: EvalWeights = { ...DEFAULT_WEIGHTS, wallDenyFrac: 0.25 };
  exps.set('stance-dose', {
    name: 'stance-dose',
    describe: 'Defense deny term at half dose (0.25) vs the shipping 0.5.',
    paired: true,
    control: { name: 'deny 0.25', weights: halfDeny },
    variant: { name: 'deny 0.50', weights: DEFAULT_WEIGHTS },
  });

  // The plain shipping ruleset. Exists because deck work needs a PER-DECK LADDER and there was
  // no first-class way to get one — ladders were being read off whatever experiment's control arm
  // happened to be baseline (which is why the vacuous `guard` run stayed in the campaign so long).
  // Pair it with --single-arm: both arms are identical, so the variant run is pure waste.
  exps.set('ladder', {
    name: 'ladder',
    describe: 'No rules change — the shipping baseline. Use with --single-arm for a per-deck ladder.',
    paired: true,
    control: { name: 'baseline' },
    variant: { name: 'baseline' },
  });

  // ---------------------------------------------------------------------------
  // Positional rules experiments (2026-08-05). Two DotR mechanics Terraforma never
  // inherited, each behind a RULES knob defaulting OFF, measured before adoption.
  //
  // They INTERACT: Support Range bounds a leader's aura so units want to be near it;
  // favored-terrain movement is the tool that gets them there, and lets a painting
  // leader lay its own road. Hence the third arm — if `positional` differs from the
  // sum of the first two, they are one mechanic rather than two dials.
  // ---------------------------------------------------------------------------
  exps.set('support-range', {
    name: 'support-range',
    describe: "Leader passive auras bounded to the leader's 8 surrounding tiles (DotR's 3x3).",
    paired: true,
    control: { name: 'global auras' },
    variant: {
      name: 'support range 1',
      setup: () => setRules({ supportRange: 1 }),
      teardown: () => resetRules(),
    },
  });
  // RETIRED 2026-08-06 — `terrain-move` and `positional`.
  //
  // `terrain-move` was ADOPTED: `RULES.favoredTerrainMove` now defaults to 1, so the experiment
  // could only compare the shipping rule against itself. Verdict, from 4 configurations:
  //   arena s0-19   fatigue 5.2%→1.3%*  rounds 18→12    arena s40-59  6.4%→1.1%*  18→12
  //   all six maps  12.9%→6.5%*  19→14  (6/6 maps improved, gauntlet 26.3%→18.1%)
  //   search policy 14.1%→2.0%*  23→17  (the effect GREW under the stronger bot)
  // Stalls stayed 0.0% throughout; the kite-stall risk it was flagged for did not appear —
  // ranged kills FELL and first blood came 2.2 rounds sooner, i.e. faster contact, not kiting.
  // Consistent costs: redmark −6pp (the Anchored formation deck), hivebrood −4pp. Spread neutral.
  //
  // `positional` measured support-range AND terrain-move together and answered its question —
  // they are two dials, not one mechanic: the combination was terrain-move's benefits plus
  // support-range's spread damage, additively (spread 62.8pp, the worst of the campaign;
  // hivebrood 22.5%, its worst anywhere). With terrain-move shipped, `support-range` below now
  // measures exactly what `positional` used to, so keeping both would be duplication.
  //
  // ⚠ `support-range` itself is NOT adopted and its 2026-08-05 result is CONFOUNDED — spread
  // widened 55.6→60.6pp, but passed turns rose 39%, and the eval already prices leader auras
  // through `unitAtk * effectiveAtk`, so the bots were not blind: covering a unit is worth ~15
  // eval points against ~45 for walking the leader into a mid-sized threat. The bots may simply
  // be right that radius 1 costs more than it pays. Re-read it before citing.

  return exps;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): { exp: string; cfg: RunCfg; full: boolean; json: boolean; csv?: string } {
  let exp = '';
  const cfg: RunCfg = {
    seeds: 20, seedOffset: 0, singleArm: false, fast: true,
    policy: 'greedy', matchups: 'all', maxTurns: 200, shuffle: true,
    knowledge: 'fog', boards: [boardById('arena')!], rules: {},
  };
  let full = false;
  let json = false;
  let csv: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    switch (arg) {
      case '--seeds':
        cfg.seeds = Number(argv[++i]);
        break;
      case '--policy': {
        const v = argv[++i];
        if (v !== 'greedy' && v !== 'search' && v !== 'expert') {
          console.error(`--policy must be greedy|search|expert (got ${JSON.stringify(v)})`);
          process.exit(1);
        }
        cfg.policy = v;
        break;
      }
      case '--no-shuffle':
        cfg.shuffle = false;
        break;
      case '--seed-offset':
        cfg.seedOffset = Number(argv[++i]);
        break;
      case '--focus':
        cfg.focus = (argv[++i] ?? '').trim();
        break;
      case '--single-arm':
        cfg.singleArm = true;
        break;
      case '--deep':
        cfg.fast = false;
        break;
      case '--knowledge': {
        const v = argv[++i];
        if (v !== 'fog' && v !== 'perfect') {
          console.error(`--knowledge must be fog|perfect (got ${JSON.stringify(v)})`);
          process.exit(1);
        }
        cfg.knowledge = v;
        break;
      }
      case '--matchups':
        cfg.matchups = argv[++i] === 'mirrors' ? 'mirrors' : 'all';
        break;
      case '--max-turns':
        cfg.maxTurns = Number(argv[++i]);
        break;
      case '--rules': {
        // --rules summoningSickTurns=0,spCap=12
        for (const pair of (argv[++i] ?? '').split(',')) {
          const [k, v] = pair.split('=');
          const key = (k ?? '').trim() as keyof RulesConfig;
          if (!(key in RULES_DEFAULTS)) {
            console.error(`unknown rule '${k}'. Known: ${Object.keys(RULES_DEFAULTS).join(', ')}`);
            process.exit(1);
          }
          const base = RULES_DEFAULTS[key];
          const parsed = typeof base === 'boolean' ? (v ?? '').trim() === 'true' : Number(v);
          if (typeof parsed === 'number' && !Number.isFinite(parsed)) {
            console.error(`rule '${k}' needs a number, got '${v}'`);
            process.exit(1);
          }
          (cfg.rules as Record<string, number | boolean>)[key] = parsed;
        }
        break;
      }
      case '--board': {
        const want = argv[++i] ?? 'arena';
        if (want === 'all') cfg.boards = [...BOARDS];
        else {
          const found = want.split(',').map((id) => boardById(id.trim())).filter((b): b is BoardDef => b !== undefined);
          if (found.length === 0) {
            console.error(`unknown board '${want}'. Known: ${BOARDS.map((b) => b.id).join(', ')}, or 'all'.`);
            process.exit(1);
          }
          cfg.boards = found;
        }
        break;
      }
      case '--full':
        full = true;
        break;
      case '--json':
        json = true;
        break;
      case '--csv':
        csv = argv[++i];
        break;
      default:
        if (!arg.startsWith('--') && !exp) exp = arg;
    }
  }
  return { exp, cfg, full, json, csv };
}

function main(): void {
  const experiments = buildExperiments();
  const { exp, cfg, full, json, csv } = parseArgs(process.argv.slice(2));

  const experiment = experiments.get(exp);
  if (!experiment) {
    console.log('Usage: npm run ab -- <experiment> [--seeds N] [--seed-offset N] [--policy greedy|search|expert]');
    console.log('                    [--focus <deckId>] [--single-arm] [--deep] [--matchups all|mirrors]');
    console.log('                    [--matchups all|mirrors] [--board <id|id,id|all>] [--max-turns N] [--no-shuffle]');
    console.log('                    [--knowledge fog|perfect]');
    console.log('                    [--rules key=value,key=value] [--full] [--json] [--csv FILE]');
    console.log('\nExperiments:');
    for (const e of experiments.values()) console.log(`  ${pad(e.name, 16)} ${e.describe}`);
    console.log(`\nMaps: ${BOARDS.map((b) => b.id).join(', ')}   (default: arena; 'all' sweeps the pool)`);
    console.log("Sweeping maps adds a per-map outcome table and a deck×map win-rate matrix.");
    process.exit(exp ? 1 : 0);
  }

  if (experiment.variant.decks && !json) {
    const sizes = experiment.variant.decks.map((d) => `${d.id}:${d.list.length}`).join('  ');
    console.log(`variant deck sizes → ${sizes}`);
  }

  const t0 = Date.now();
  // Background ruleset for BOTH arms. Restored after, so a --json/--csv consumer in the same
  // process never inherits it.
  setRules(cfg.rules);
  const cRes = runArm(experiment.control, cfg);
  // Both arms identical (see `ladder`): running the variant would compute the same games twice.
  const vRes = cfg.singleArm ? cRes : runArm(experiment.variant, cfg);
  const rulesUsed = Object.entries(cfg.rules).map(([k, v]) => `${k}=${v}`).join(' ');
  resetRules();
  const ctrl = aggregate(cRes);
  const varr = aggregate(vRes);

  if (json) {
    console.log(
      JSON.stringify(
        { experiment: experiment.name, config: cfg, control: ctrl, variant: varr },
        null,
        2,
      ),
    );
  } else {
    printReport(experiment, cfg, ctrl, varr, cRes, vRes);
    if (full) printFull(ctrl, varr);
    console.log(`(${cRes.length + vRes.length} games in ${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  }

  if (csv) writeCsv(csv, cRes, vRes);
}

main();
