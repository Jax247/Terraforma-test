// Position evaluation for the greedy bot. Reads ONLY engine primitives —
// effectiveAtk (which already prices terrain, Frenzy, auras, leader passives,
// and timed statuses), unit level, zone counts, and board geometry. No card
// names: the function stays correct as content and the stat formula churn.

import {
  BOARD_SIZE,
  effectiveAtk,
  effectiveDef,
  flankAllies,
  isPinnedByGuard,
  cannotAttack,
  hasKeyword,
  isDisarmed,
  isSnared,
  isStunned,
  isSuppressed,
  leaderOf,
  mooreAdjacent,
  orthAdjacent,
  rangedTargets,
  sameCoord,
  RULES,
  setCardCount,
  setSpCost,
  spellSpCost,
  tileAt,
  unitAt,
  unitSlots,
  unitSpCost,
} from '../engine';
import type { CardDef, Coord, Effect, GameState, PlayerId, Unit } from '../engine';

/** Movement is orthogonal, so Manhattan distance changes by exactly 1 per step —
 *  Chebyshev has zero gradient along diagonals and froze chasing armies in self-play. */
function manhattan(a: Coord, b: Coord): number {
  return Math.abs(a.col - b.col) + Math.abs(a.row - b.row);
}

export interface EvalWeights {
  /** Terminal score — dominates every material consideration. */
  win: number;
  /** Per point of leader LP. */
  lifeDiff: number;
  /**
   * Added to lifeDiff per own turn taken. Late game, LP must dwarf material and
   * position or fortress stalls never break: self-play showed an army camped
   * around a cornered enemy leader, refusing chip attacks because a unit adjacent
   * to the leader is worth more standing (threat term) than the LP it can deal.
   */
  lifeDiffRamp: number;
  /** Ceiling for the ramped LP weight. */
  lifeDiffCap: number;
  /** Per point of a non-leader unit's effective ATK. */
  unitAtk: number;
  /** Per point of effective DEF for a unit in defense stance. Kept at unitAtk, so on the stat
   *  swap alone a body defends exactly when its DEF beats its ATK contribution. That comparison
   *  is necessary but nowhere near sufficient — see `wallDenyFrac` / `wallReflectFrac`. */
  unitDef: number;
  /**
   * Fraction of the ramped LP weight, per point of **overflow this body denies** by standing in
   * defense stance rather than attack stance (2026-08-04).
   *
   * THE term that makes a bot defend at all. Combat overflow means an out-statted body in attack
   * stance does not merely die — it pays the margin to its own leader's pool. A defending body
   * that gets broken concedes **nothing** (unless the attacker Pierces). So against a threat that
   * out-stats it, defending converts a bleeding loss into a clean one, and the old evaluator could
   * not see one point of that: it compared DEF against ATK and stopped.
   *
   * Priced HIGH (near par) because it is the near-certain half. If an adjacent enemy out-stats a
   * body, the opponent takes that attack — it is a free kill plus LP.
   */
  wallDenyFrac: number;
  /**
   * Fraction of the ramped LP weight, per point of **reflect** a held wall would deal to the
   * attacker's owner (2026-08-04).
   *
   * Priced LOW, and the asymmetry with `wallDenyFrac` is the point: reflect is damage the OPPONENT
   * has to volunteer for. A competent opponent simply declines to attack into a wall it cannot
   * break, so the honest value of reflect is deterrence, not damage — it is worth even less than
   * a threatened leader chip (`threatChipFrac`), which at least does not depend on the opponent
   * choosing to lose material.
   */
  wallReflectFrac: number;
  /** Per unit level — values utility bodies beyond raw ATK (tokens are level 0). */
  unitLevel: number;
  /** Per card in hand. */
  handCard: number;
  /**
   * Discount per hand card above RULES.handCap−2. Near the cap the marginal card is
   * worth handCard − handPressure, so casting/setting extracts value where a
   * full-price hand made every cast look like a 10-point loss — self-play sat
   * at 7 cards burning overdraws (20 burns in one instrumented game) instead
   * of ever casting.
   */
  handPressure: number;
  /**
   * Per point of a player's current SP. Endpoint-neutral for the search bot
   * (SP refreshes to spMax before its after-reply eval, identically for every
   * candidate) — its real job is BEAM RANKING: a mid-turn "cast economy spell"
   * state ranks above its −1-card dip, so cast-then-spend lines survive to
   * show their payoff. Instrumented self-play averaged 6–10 unspent SP/turn
   * with economy spells never cast.
   */
  spValue: number;
  /** Per face-down card on the board (kept near handCard so setting isn't refused). */
  setCard: number;
  /** Per tile of a friendly unit's proximity to the ENEMY leader (aggression gradient). */
  leaderThreat: number;
  /** Per tile of an enemy unit's proximity to OUR leader (defensive mirror). */
  leaderExposure: number;
  /**
   * Added to leaderThreat per own turn taken — OFFENSE ONLY. Greedy armies otherwise
   * camp on Frenzy packs and favored terrain forever (self-play stalls at full LP);
   * ramping aggression turns camping into marching as the game drags on. The ramp
   * must NOT apply to leaderExposure: a ramped exposure weight made both leaders
   * kite to opposite corners forever in self-play.
   */
  leaderThreatRamp: number;
  /** Ceiling for the ramped threat weight. */
  leaderThreatCap: number;
  /** Per friendly unit standing on a spring tile (SP-engine control). */
  springHold: number;
  /**
   * Threatened chip: fraction of the live per-LP weight charged per point of
   * enemy effective ATK that can hit our leader NEXT turn. Movement is one
   * orthogonal step and Ranged reach is also orth-adjacent, so the threat set
   * is exactly the enemy non-leader units orthogonally adjacent to our leader
   * (extraMove resets at end of turn; summoning sickness clears at the start
   * of theirs, so sick units still count). Below 1 because the chip is an
   * option, not a certainty — the attacker may die to strikeback or get
   * answered first. Unlike the reverted ramped-exposure idea this has no
   * long-range gradient, so it cannot drive corner-kiting.
   */
  threatChipFrac: number;
  /**
   * GUARD (pin), 2026-08-09. Credit for each ENEMY unit currently held by one of our Guards,
   * scaled by what is being held — a pinned 60-ATK body is worth far more than a pinned chump.
   *
   * Sized UNDER `snaredAtk` (1) because a pin denies strictly less than a snare: the victim may
   * still shuffle between the Guard's other adjacent tiles, and may still attack anything in
   * reach, including the Guard itself. It is a positional tax, not a denial.
   *
   * ⚠ Unlike the denial-status terms this one DOES count leaders, because leaders are pinnable —
   * the 2026-08-02 CC-immunity fizzles denial *statuses* at the `applyStatus` chokepoint, and a
   * pin is a positional fact about a body on the board, not a status.
   */
  pinnedAtk: number;
  /**
   * Own turns over which the threatened-chip price fades linearly to zero.
   * Without the fade, mirror self-play stalls at FULL LP in ~2-4% of matchups
   * (seed-dependent): stepping out of adjacency is genuinely correct play, both
   * leaders do it every turn, and chasers move at the same speed — so no chip
   * ever lands and the drift alarm's progress invariant trips. Fading defense
   * out hands the endgame back to the aggression ramp, which reliably finishes.
   */
  threatChipFadeTurns: number;
  /** Greedy improvement threshold: actions must beat the current state by this much. */
  actionEpsilon: number;

  // -------------------------------------------------------------------------
  // DECK-DEPTH / FATIGUE CLOCK (2026-08-02). See `projectedFatigueLp`.
  // -------------------------------------------------------------------------

  /**
   * Fraction of the live per-LP weight charged per point of LP a side is PROJECTED to lose to
   * fatigue within `fatigueHorizon` of its own turns. Scored for both sides and subtracted, so
   * it stays zero-sum: a shallow deck is a debt, and an opponent's shallow deck is an asset.
   *
   * Why a fraction rather than full price: unlike LP already lost, this damage is a forecast
   * made from deck length alone. Draw effects pull it forward and a finished game cancels it,
   * so pricing it at par would let a 30-LP phantom outweigh 30 LP actually on the board.
   */
  fatigueFrac: number;
  /**
   * Own turns of lookahead for that projection — the length of the "the deck is running out"
   * window. Below it the term is exactly 0, which is the point: with a 40-card deck nothing
   * should change for the first two thirds of a game, and every A/B baseline measured before
   * this term existed stays comparable in that stretch.
   */
  fatigueHorizon: number;
  /**
   * DESPERATION. Multiplier added to our own aggression gradient (up to ×(1+this)) as we fall
   * behind on EFFECTIVE LP — real LP minus projected fatigue. A bot that is going to lose the
   * race gains nothing from an even trade; it has to force the kill inside the time it has.
   *
   * Deliberately one-sided (it scales `leaderThreat`, never `leaderExposure`) and deliberately
   * applied AFTER `leaderThreatCap`: the cap exists to stop terrain camping from outbidding the
   * march, and desperation is exactly the case where the march should outbid everything else.
   * The mirror case needs no knob — a winning bot already gets the ramp.
   */
  desperationPush: number;
  /**
   * ABSOLUTE clock urgency, default 0 (inert). Same aggression multiplier as `desperationPush`,
   * but keyed on how much of OUR OWN LP the forecast fatigue would eat, regardless of how the
   * opponent is doing.
   *
   * Why it exists (2026-08-02, `defense-fatigue-clock`): `desperationPush` is differential, and a
   * differential term cannot break a SYMMETRIC standoff. In the defense-mode wall mirror both
   * bots thin their decks in lockstep at equal LP, so the debt cancels, urgency is 0 on both
   * sides, and the measured result is exactly nil — 100% fatigue and 100% passed endgame turns in
   * both arms. Both players are dying to the clock and neither is *behind*. Only a term that
   * says "my own clock is running, so advance" can move that position.
   *
   * MEASURED AND LEFT AT 0 — it does not work either, and the reason is worth keeping. In the
   * frozen wall mirror the only legal actions are leader shuffles (Δ 0), an ability (Δ −1) and
   * leaving defense stance (Δ −22.5 / −7.5, because a wall's DEF exceeds its ATK). Scaling the
   * aggression gradient cannot touch any of those: a unit in defense stance may not move, so the
   * gradient it scales is multiplying a term that no legal action can change. `clockPush 20`
   * raises the position's score from −5 to 535 and every action delta stays bit-identical.
   * Measured: `defense-clock-push` 0/28.1% fatigue unchanged, passes 21.9 → 21.3;
   * `clock-push` on the registered decks 3/294 outcomes changed.
   *
   * What that leaves: price the OPTION the stance costs (score defense stance itself while the
   * clock runs, not the gradient), make holding cost something in the RULES (stance upkeep or
   * decay), or accept that a one-ply bot cannot value unlocking a wall — the payoff always lands
   * a ply after the cost. Kept in-repo dark like the other tested-null levers.
   */
  clockPush: number;

  // -------------------------------------------------------------------------
  // SUPPORT-CARD terms (2026-08-01). All default to 0, so Normal and Hard score
  // exactly as they did before these existed and stay valid A/B baselines; the
  // Expert tier turns them on via EXPERT_WEIGHTS.
  //
  // Why they exist: instrumented self-play priced every support card in the
  // probe decks and found whole categories are worth literally nothing to the
  // evaluator. Measured eval delta when castable (max / median over 12 games):
  //   Draw 1 + GainSP 1 ......  0.0 /  0.0  — ±0 cards, ±0 SP: neutral BY CONSTRUCTION
  //   GrantMove 1 ............ -6.0 / -6.0  — extraMove is scored nowhere
  //   Stun ............. -6.0 / -6.0  — no mobility-denial term
  // A card-COUNTING hand term ("every card is worth handCard") can never price a
  // cantrip, because trading a known card for an unknown one is a no-op to it.
  // -------------------------------------------------------------------------

  /**
   * Per hand card that is playable right now AND can actually change the board.
   *
   * The "change the board" half is what prices a cantrip correctly, and it took a
   * failing test to get right: a pure Draw/GainSP spell IS playable, so a
   * castability-only bonus valued it exactly as highly as the card it would draw,
   * and casting it stayed a no-op. Scoring it as a card that cannot affect the
   * board makes it what it really is — a placeholder for a real card — so trading
   * it for an unknown is a gain. That is the honest reason to cycle, not a thumb
   * on the scale.
   */
  handPlayableBonus: number;
  /** Per hand card with no legal play right now. Also makes a forced BurnCard
   *  discard the dead card instead of an arbitrary one. */
  handDeadPenalty: number;
  /**
   * Per point of effective ATK of a Stunned enemy. ON for every tier, unlike the support terms
   * below, because the board itself can stun now: a sigil hits whatever walks onto it, so a bot
   * that cannot see a stun will step on marked ground over and over at any difficulty.
   *
   * Sized at `unitAtk`, which reads as "a stunned body is worth about what removing it is
   * worth" — and since a Stunned unit cannot strike back, that is close to literally true: any
   * body can walk into it and trade nothing. The bot needs no separate term to go and take that
   * kill; the state after killing simply scores better.
   */
  stunnedAtk: number;
  /**
   * Per point of effective ATK of a SNARED enemy — counted only when it is NOT `Ranged`.
   * Snare denies movement, and because move-is-attack that shuts a melee body down completely;
   * a Ranged body just keeps shooting from where it stands, which is precisely the counter the
   * status is designed around. Pricing a snared shooter as denied would teach the bot to waste
   * its snares on the one target immune to them.
   */
  snaredAtk: number;
  /** Per point of effective ATK of a DISARMED enemy. No Ranged carve-out — disarm stops
   *  shooting too; the unit keeps only its legs. */
  disarmedAtk: number;
  /**
   * Per point of switched-off TEXT on a suppressed enemy — its printed rules plus its keywords.
   *
   * Deliberately not priced per ATK like the others: suppression already lowers the unit's
   * effective ATK (Frenzy and its own auras stop applying), and `unitAtk` prices that drop from
   * the opponent's side automatically. Paying per ATK again would double-count the stat half and
   * value suppressing a vanilla body — which is worth nothing, since it has no text to silence.
   */
  suppressedText: number;
  /**
   * Per own set card whose 3×3 trap zone covers an enemy unit or a tile adjacent
   * to one — i.e. armed and plausibly about to fire. Flat `setCard` values HAVING
   * a face-down card; this values putting it somewhere it matters.
   */
  trapZoneThreat: number;
  /** Per tile of unspent granted movement on our own units (reach this turn). */
  extraMoveTile: number;
}

export const DEFAULT_WEIGHTS: EvalWeights = {
  win: 1e9,
  lifeDiff: 6,
  lifeDiffRamp: 1.5,
  lifeDiffCap: 40,
  // Kept low so terrain/aura camping (±10 ATK swings) can't permanently outweigh
  // the aggression ramp — the sum must stay below leaderThreatCap or self-play stalls.
  unitAtk: 1.5,
  unitDef: 1.5,
  // Near par: the overflow a wall denies is damage the opponent is otherwise taking for free.
  wallDenyFrac: 0.5,
  // Well under threatChipFrac (0.25): reflect only lands if the opponent chooses to eat it.
  wallReflectFrac: 0.1,
  unitLevel: 8,
  handCard: 10,
  // Marginal cards 6–7 are worth 10 − 6 = 4: enough that a modest spell effect
  // (> ~4.5) beats hoarding into a forced burn, without devaluing a small hand.
  handPressure: 6,
  spValue: 1,
  // Above handCard on purpose: setting a card must be a (small) eval GAIN or a
  // greedy one-ply bot never sets traps/units face-down at all.
  setCard: 11,
  leaderThreat: 1.5,
  leaderExposure: 2,
  // Cap must exceed the biggest per-tile camp differential (aura + terrain ≈
  // 20 ATK × unitAtk = 30 eval) or armies never leave their favored terrain.
  leaderThreatRamp: 2.5,
  leaderThreatCap: 40,
  springHold: 6,
  // A/B 2026-07-18, greedy vs frac-0 control, 98 games/arm across all ordered
  // deck matchups: 0.15/0.25/0.5 all ≈ +57/−25 wins, avg LP margin +65 — the
  // term's presence matters far more than its size. 0.25 had the most wins and
  // fewest draws. Known cost at any frac: greedy mirrors get more drawish
  // (38-39/49 decided vs 45/49 at frac 0) because two chip-averse leaders can
  // kite each other in an open board — the mechanical fix (Guard keyword or
  // similar) is a design question, not an eval knob.
  threatChipFrac: 0.25,
  pinnedAtk: 0.6,
  // Past the fade the aggression ramp (capped ~turn 16) is already dominant.
  threatChipFadeTurns: 20,
  actionEpsilon: 0.5,
  // Deck-depth terms — see `projectedFatigueLp` for the sizing argument.
  fatigueFrac: 0.5,
  fatigueHorizon: 10,
  desperationPush: 1,
  clockPush: 0,
  // Board-safety, not a support term: every tier must see a stun (sigils, traps). Sized at
  // `unitAtk` so pinning a body is worth about what taking its ATK off the board is worth.
  stunnedAtk: 1.5,
  // Sized under stunnedAtk: each denies half of what a stun denies, and each has an out.
  snaredAtk: 1,
  disarmedAtk: 1,
  // Per rule/keyword silenced. Well under a point of ATK — the stat half is already priced.
  suppressedText: 4,
  // Support-card terms OFF by default — see the interface. Normal/Hard are unchanged.
  handPlayableBonus: 0,
  handDeadPenalty: 0,
  trapZoneThreat: 0,
  extraMoveTile: 0,
};

/** True when the weights leave every support term at 0 — i.e. legacy Normal/Hard scoring. */
export function supportTermsOff(w: EvalWeights): boolean {
  return (
    w.handPlayableBonus === 0 &&
    w.handDeadPenalty === 0 &&
    w.trapZoneThreat === 0 &&
    w.extraMoveTile === 0
  );
}

/** Does this unit have a live firing line right now? A snared shooter with one is not denied. */
function canStillShoot(s: GameState, u: Unit): boolean {
  if (!hasKeyword(u, 'Ranged') || cannotAttack(u)) return false;
  return rangedTargets(s, u).some((c) => {
    const t = unitAt(s, c);
    return t !== undefined && t.owner !== u.owner;
  });
}

/**
 * The ATK a threat would actually land on `target`'s tile.
 *
 * Melee and a shot differ in one term: a shooter never leaves its tile, so its terrain resolves
 * where it stands rather than on the battle tile (see `effectiveAtk`). A unit that could do either
 * is priced at the better of the two, because that is the one it would pick.
 */
function threatAtk(s: GameState, t: Unit, target: Unit, adjacent: boolean, shooting: boolean): number {
  const ctx = { role: 'attacker' as const, battleTile: target.pos, opponentId: target.id };
  const melee = adjacent ? effectiveAtk(s, t, ctx) : -Infinity;
  const shot = shooting ? effectiveAtk(s, t, { ...ctx, ranged: true }) : -Infinity;
  return Math.max(melee, shot);
}

/**
 * The worst attack `u` could face on the opponent's next action, as combat would actually
 * resolve it — total effective ATK at u's own tile, flank included.
 *
 * The threat set mirrors the leader's (see `threatChipFrac`): orth-adjacent bodies, since movement
 * is one step and moving IS attacking, plus any Ranged enemy whose exact firing distance already
 * covers this tile. Bodies that cannot attack are not threats. Enemy LEADERS are threats too —
 * since the 2026-08-04 ruling they resolve against a defending unit's DEF like anything else.
 *
 * Two numbers, because the two halves of `defenseValue` ask different questions:
 *   `worstAtk`   the biggest incoming attack, leaders included — what the wall has to survive.
 *   `worstDeny`  the most overflow any ONE threat could extract from this body in attack stance.
 *                Leaders are excluded: leader-vs-unit combat is binary for the unit and spills no
 *                LP either way, so there is no overflow for the stance to deny. Piercers are
 *                excluded too — they trample the margin through the wall regardless.
 */
function worstIncomingAttack(s: GameState, u: Unit): { worstAtk: number; worstDeny: number } | undefined {
  let worstAtk: number | undefined;
  let worstDeny = 0;
  const myAtk = effectiveAtk(s, u);
  for (const t of Object.values(s.units)) {
    if (t.owner === u.owner || cannotAttack(t)) continue;
    const adjacent = orthAdjacent(u.pos).some((c) => sameCoord(c, t.pos));
    const shooting = hasKeyword(t, 'Ranged') && rangedTargets(s, t).some((c) => sameCoord(c, u.pos));
    if (!adjacent && !shooting) continue;
    const eff = threatAtk(s, t, u, adjacent, shooting);
    // Leaders neither grant nor receive a flank bonus.
    const flank = t.isLeader
      ? 0
      : RULES.flankPerAlly * Math.min(RULES.flankMaxAllies, flankAllies(s, u.pos, t.owner, t.id));
    const atk = eff + flank;
    if (worstAtk === undefined || atk > worstAtk) worstAtk = atk;
    if (!t.isLeader && !hasKeyword(t, 'Piercing')) worstDeny = Math.max(worstDeny, atk - myAtk);
  }
  return worstAtk === undefined ? undefined : { worstAtk, worstDeny: Math.max(0, worstDeny) };
}

/**
 * What standing in defense stance is worth to `u`, in LP, beyond the DEF-for-ATK stat swap.
 *
 * Two components, returned already multiplied by their fractions so the caller only scales by the
 * ramped LP weight:
 *
 *   DENY     the overflow this body would have conceded had it stood in attack stance and lost.
 *            A broken wall pays nothing, so defense denies all of it. Zero against a leader (that
 *            fight is binary and spills no LP either way) and zero against a piercer (it tramples
 *            the margin through the wall regardless).
 *   REFLECT  what the attacker's owner pays if it attacks into a wall it cannot break — including
 *            a LEADER's own pool, since the 2026-08-04 ruling routes leaders through the same
 *            table. Note the trade that creates: against a leader, holding in defense reflects
 *            only the MARGIN, where surviving in attack stance strikes back for full ATK. The two
 *            terms price both sides of that honestly rather than assuming defense always wins.
 *
 * Zero for an unthreatened body, which is correct and load-bearing: defending costs a unit its
 * action, so with nothing able to reach it the stat swap SHOULD be a straight loss and the bot
 * should keep moving.
 */
function defenseValue(s: GameState, u: Unit, w: EvalWeights): number {
  const worst = worstIncomingAttack(s, u);
  if (!worst) return 0;
  const reflect = Math.max(0, effectiveDef(s, u) - worst.worstAtk);
  return w.wallDenyFrac * worst.worstDeny + w.wallReflectFrac * reflect;
}

/**
 * How much printed text a suppression is actually silencing: rules + keywords. A vanilla body
 * scores 0, which is correct — there is nothing to switch off. Read from the CARD, not the unit's
 * live state, because that is what suppression suspends.
 */
function silencedText(s: GameState, u: Unit): number {
  const def = s.cardDefs[u.cardId];
  const rules = def?.kind === 'unit' ? def.rules.length : 0;
  return rules + u.keywords.length;
}

/** Effects that only refill resources. A card built solely from these cannot touch the board. */
const CYCLING_EFFECTS: ReadonlySet<Effect['e']> = new Set<Effect['e']>(['Draw', 'GainSP']);

/**
 * Can this card do anything to the board? A unit always can (it is a body). A spell or trap
 * whose every line is Draw/GainSP cannot — it only replaces itself, which is precisely why
 * holding it is worth less than holding the card it would find.
 */
function hasBoardImpact(def: CardDef): boolean {
  if (def.kind === 'unit') return true;
  return def.effects.some((l) => !CYCLING_EFFECTS.has(l.effect.e));
}

/**
 * Can this hand card be played THIS action, ignoring target availability?
 *
 * Deliberately an approximation: `evaluate` runs thousands of times per planned turn, and
 * calling `enumerateBoundActions` here (12.5µs) would cost more than the whole search. Checks
 * the two things that actually gate a card most of the time — SP and the board caps.
 *
 * The caps are passed in rather than recomputed: `unitSlots`/`setCardCount` each scan every
 * unit and set card, and calling them once per hand card turned a 3.4µs eval into 5.5µs.
 */
function isPlayableNow(def: CardDef, sp: number, unitRoom: boolean, setRoom: boolean): boolean {
  // A unit is live if it can be summoned OR set face-down — both cost the same and take a slot.
  if (def.kind === 'unit') return sp >= unitSpCost(def) && unitRoom;
  // A trap is only ever SET, and setting one costs SP now.
  if (def.kind === 'trap') return setRoom && sp >= setSpCost(def);
  // A spell can be cast outright or set for later — a mine prepays its SP at set, so both
  // routes are priced; a board spell sets for free and pays at flip.
  return (setRoom && sp >= setSpCost(def)) || sp >= spellSpCost(def);
}

/**
 * One side's non-positional score plus its threat gradient toward the enemy leader.
 * evaluate() is sideScore(me) - sideScore(opp) with the threat term weighted
 * leaderThreat for us and leaderExposure for them, so the two knobs let the bot
 * value offense and defense differently.
 */
function sideScore(s: GameState, p: PlayerId, threatWeight: number, lifeWeight: number, chipPrice: number, w: EvalWeights): number {
  const opp: PlayerId = p === 0 ? 1 : 0;
  const ps = s.players[p];
  const enemyLeaderPos = leaderOf(s, opp).pos;

  const overfull = Math.max(0, ps.hand.length - (RULES.handCap - 2));
  let score =
    lifeWeight * ps.leaderLife +
    w.handCard * ps.hand.length -
    w.handPressure * overfull +
    w.spValue * ps.sp;


  // Hand QUALITY on top of hand count (both 0 by default). Counting cards alone cannot price a
  // cantrip; grading each card into can-act / can't-pay / can-act-but-does-nothing can.
  if (w.handPlayableBonus !== 0 || w.handDeadPenalty !== 0) {
    const unitRoom = unitSlots(s, p) < RULES.unitCap;
    const setRoom = setCardCount(s, p) < RULES.nonUnitCap;
    for (const cardId of ps.hand) {
      const def = s.cardDefs[cardId];
      if (!def) continue;
      if (!isPlayableNow(def, ps.sp, unitRoom, setRoom)) score -= w.handDeadPenalty;
      else if (hasBoardImpact(def)) score += w.handPlayableBonus;
      // Playable but pure cycling: worth its flat handCard and no more. That gap is exactly
      // what makes swapping it for an unknown card a gain rather than a wash.
    }
  }

  for (const sc of Object.values(s.setCards)) {
    if (sc.owner !== p) continue;
    score += w.setCard;
    // Placement value: a face-down card whose trap zone (the 3×3 fireTraps geometry) covers an
    // enemy — or the ring they must step through to reach it — is armed; one in a back corner
    // is a card sat on the floor. Deliberately geometric, not identity-based: it applies to the
    // bluff too, which is correct, and it never peeks at what the card actually is.
    if (w.trapZoneThreat !== 0) {
      const zone = [sc.pos, ...mooreAdjacent(sc.pos)];
      const armed = zone.some((c) => {
        const t = unitAt(s, c);
        if (t && t.owner !== p && !t.isLeader) return true;
        return orthAdjacent(c).some((n) => {
          const q = unitAt(s, n);
          return q !== undefined && q.owner !== p && !q.isLeader;
        });
      });
      if (armed) score += w.trapZoneThreat;
    }
  }

  for (const u of Object.values(s.units)) {
    if (u.owner !== p) continue;
    if (!u.isLeader) {
      // A defending body can't attack, so it is valued by survivability (DEF) instead of ATK —
      // plus what the stance is actually WORTH against the threats on the board right now, which
      // is the half the stat swap alone cannot see. Added to the own-side score only: `evaluate`
      // is `sideScore(me) − sideScore(opp)`, so an enemy wall is already a negative for us
      // through the subtraction, and signing this by ownership would double-count it.
      if (u.stance === 'defense') {
        score += w.unitDef * effectiveDef(s, u) + w.unitLevel * u.level;
        score += lifeWeight * defenseValue(s, u, w);
      } else {
        score += w.unitAtk * effectiveAtk(s, u) + w.unitLevel * u.level;
      }
      score += threatWeight * (2 * BOARD_SIZE - manhattan(u.pos, enemyLeaderPos));
      // Granted movement is reach the opponent has to respect, and it expires at end of turn —
      // without this a GrantMove spell is a pure card-and-SP loss to the evaluator.
      score += w.extraMoveTile * u.extraMove;
    }
    if (tileAt(s.board, u.pos).spring) score += w.springHold;
  }

  // Enemy pieces WE have locked down. Stun is priced by what it switches off: a pinned 45-ATK
  // body cannot attack, so it is worth roughly what its threat was worth.
  //
  // Enemy-only on purpose, and do NOT "fix" this into an ownership-signed term: `evaluate` is
  // `sideScore(me) − sideScore(opp)`, so the own-side penalty already falls out of the
  // subtraction — one of our stunned units scores for the opponent and is subtracted. Signing it
  // here double-counts. That own-side half is what makes a bot respect marked ground: a sigil
  // stuns on entry, so the state reached by stepping onto one already carries the status and
  // reads as a loss, with no sigil-specific lookahead anywhere.
  for (const u of Object.values(s.units)) {
    if (u.owner === p || u.isLeader) continue; // leaders are CC-immune
    if (w.stunnedAtk !== 0 && isStunned(u)) score += w.stunnedAtk * effectiveAtk(s, u);
    // Snare denies movement. For a melee body that is total; for a shooter it depends on whether
    // it can already see something — exact range means a snared archer with an empty firing line
    // cannot step to fix it, so it IS fully denied. (Before exact range a shooter simply shrugged
    // snares off, and this was a flat carve-out.)
    if (w.snaredAtk !== 0 && isSnared(u) && !canStillShoot(s, u)) {
      score += w.snaredAtk * effectiveAtk(s, u);
    }
    if (w.disarmedAtk !== 0 && isDisarmed(u)) score += w.disarmedAtk * effectiveAtk(s, u);
    if (w.suppressedText !== 0 && isSuppressed(u)) score += w.suppressedText * silencedText(s, u);
  }

  // Threatened chip against OUR leader (see threatChipFrac). Priced with the
  // attacker-role effectiveAtk at the leader's tile so terrain there is real.
  const myLeader = leaderOf(s, p);
  // The threat set is every enemy that could hit our leader on its NEXT action: orth-adjacent
  // bodies (movement is one step, and moving IS attacking) plus any Ranged unit whose exact
  // firing distance already covers the leader's tile. That second half is not optional — a
  // range-2 shooter parked two tiles away is a real next-turn threat, and before exact range
  // existed the two sets happened to coincide, which is why this used to read adjacency alone.
  for (const t of Object.values(s.units)) {
    if (t.owner !== opp || t.isLeader) continue;
    const adjacent = orthAdjacent(myLeader.pos).some((c) => sameCoord(c, t.pos));
    const shooting = hasKeyword(t, 'Ranged')
      && rangedTargets(s, t).some((c) => sameCoord(c, myLeader.pos));
    if (!adjacent && !shooting) continue;
    score -= chipPrice * threatAtk(s, t, myLeader, adjacent, shooting);
  }

  // GUARD (pin): credit for enemies our Guards are holding. Its own loop rather than a line in the
  // denial block above, because that block skips leaders as CC-immune and a pin is not CC.
  if (w.pinnedAtk !== 0) {
    for (const u of Object.values(s.units)) {
      if (u.owner === p || !isPinnedByGuard(s, u)) continue;
      score += w.pinnedAtk * effectiveAtk(s, u);
    }
  }
  return score;
}

/**
 * LP `p` is on track to lose to fatigue within its next `horizon` own turns.
 *
 * The model is the draw rule, nothing more: one card per own turn (engine `startTurn`), and the
 * n-th missed draw costs `fatigueStep × n` — so a player `d` cards deep takes its first hit on
 * own turn `d+1`, and the hits escalate. Both halves matter: deck length says WHEN the clock
 * fires, `ps.fatigue` says how expensive each further tick already is for a player mid-burn.
 *
 * Capped at current LP because that is where the game ends — without the cap a deep horizon
 * invents damage past a lethal total and the desperation term reads the race wrongly.
 *
 * What it deliberately does NOT model: extra draws from card effects (they pull the clock in,
 * but the evaluator sees the shorter deck the moment they resolve, which is the same signal one
 * turn later) and shuffle-backs (the engine has none). Approximate on purpose — it is a horizon
 * device for a bot that would otherwise walk into fatigue with no warning at all, priced below
 * par by `fatigueFrac` precisely because it is approximate.
 */
export function projectedFatigueLp(s: GameState, p: PlayerId, horizon: number): number {
  const ps = s.players[p];
  const misses = Math.max(0, Math.floor(horizon) - ps.deck.length);
  if (misses <= 0 || RULES.fatigueStep <= 0) return 0;
  // Ticks fatigue+1 … fatigue+misses, each worth fatigueStep × its index.
  const total = RULES.fatigueStep * (misses * ps.fatigue + (misses * (misses + 1)) / 2);
  return Math.min(Math.max(0, ps.leaderLife), total);
}

/** Score the position from `me`'s perspective: positive is good for `me`. */
export function evaluate(s: GameState, me: PlayerId, w: EvalWeights = DEFAULT_WEIGHTS): number {
  if (s.winner !== undefined) return s.winner === me ? w.win : -w.win;
  const opp: PlayerId = me === 0 ? 1 : 0;
  const turns = Math.max(0, s.players[me].turnCount - 1);
  let myThreat = Math.min(w.leaderThreatCap, w.leaderThreat + w.leaderThreatRamp * turns);
  // LP weight ramps for BOTH sides' pools (it scores a difference), so it stays
  // zero-sum under symmetric weights while making LP dominate as the game drags on.
  const life = Math.min(w.lifeDiffCap, w.lifeDiff + w.lifeDiffRamp * turns);
  // Same price for both sides (zero-sum under symmetric weights); fades to zero
  // so the endgame belongs to the aggression ramp (see threatChipFadeTurns).
  const chipPrice = w.threatChipFrac * life * Math.max(0, 1 - turns / w.threatChipFadeTurns);

  // Deck depth. Both terms read the same projection, so the clock is computed at most once.
  let deckDebt = 0;
  if (w.fatigueFrac !== 0 || w.desperationPush !== 0 || w.clockPush !== 0) {
    const myFatigue = projectedFatigueLp(s, me, w.fatigueHorizon);
    const oppFatigue = projectedFatigueLp(s, opp, w.fatigueHorizon);
    // Priced like LP because that is what it is — LP, later. Zero-sum: symmetric weights make
    // my debt exactly the opponent's asset.
    deckDebt = w.fatigueFrac * life * (oppFatigue - myFatigue);
    if (w.desperationPush !== 0 || w.clockPush !== 0) {
      // Urgency measured against the ENEMY's remaining effective pool, not the starting total:
      // 40 LP down with 180 left on the other side is a game to play out, the same 40 down with
      // 45 left is a game to finish now. Clamped to [0,1] so a won race never damps aggression.
      const myEff = s.players[me].leaderLife - myFatigue;
      const oppEff = s.players[opp].leaderLife - oppFatigue;
      const urgency = Math.min(1, Math.max(0, (oppEff - myEff) / Math.max(1, oppEff)));
      // Own-clock urgency: what fraction of our remaining LP the forecast would take. Additive
      // with the differential term because they answer different questions — "am I losing?" and
      // "am I running out of time?" — and a mutual turtle is the case where only the second is
      // true (see `clockPush`).
      const clock = Math.min(1, myFatigue / Math.max(1, s.players[me].leaderLife));
      myThreat *= 1 + w.desperationPush * urgency + w.clockPush * clock;
    }
  }
  return (
    sideScore(s, me, myThreat, life, chipPrice, w) -
    sideScore(s, opp, w.leaderExposure, life, chipPrice, w) +
    deckDebt
  );
}
