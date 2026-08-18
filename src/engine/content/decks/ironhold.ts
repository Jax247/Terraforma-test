// Ironhold — Captain Rhodan. Terra/Warrior, homes split Mountain/Grassland.
//
// THE STARTER DECK, and the A/B control deck. Those two jobs agree more than they conflict, and
// where they conflict, LEGIBILITY WINS.
//
// ---------------------------------------------------------------------------
// Axis: STANCE — the brace/swing decision.
// Verbs: brace · hold · punish · advance.
// ---------------------------------------------------------------------------
//
// Every other deck answers "attack or defend?" at DECKBUILD time: Anvil prints ATK << DEF, Piercer
// prints ATK >> DEF, so their bodies have one job and the stance flag is a stat lookup. Ironhold's
// bodies are deliberately stance-AMBIVALENT — ATK and DEF close enough that neither posture is
// obviously right — so the question is asked fresh every turn, on the board, by the player.
//
// That is also why it teaches: putting ATK and DEF side by side as comparable numbers is how a new
// player learns there are two stats at all.
//
// WHAT IT DOES NOT CONTAIN, on purpose: traps, mines, fusion, Ascension, denial statuses, Ranged,
// sigils. Each is a rule a beginner should not meet in their first deck. The same narrowness is
// what makes it a stable A/B control — most experiments cannot perturb a deck that touches few
// subsystems.
//
// TEXT BUDGET: 4 of 14 cards carry a rule, each one line, each teaching exactly one system.
// The other 8 are vanilla, and vanilla here is a feature rather than filler.
//
// STATED WEAKNESSES (rules, not vibes — and every counter already exists):
//   · Piercing ignores defense outright — Piercer is built on it.
//   · Ranged bypasses the punish half: retaliation requires reach, so a range-2 shooter hits a
//     braced body and takes nothing back. The Red Mark counters this deck for free.
//   · A braced unit deals nothing that turn. Bracing always costs tempo.
//   · Split home means it rarely gets the +10, and only sometimes the favored-terrain +1 move.

import type { CardDef, LeaderDef } from '../../types';
import { dup, unitDc, type DeckDef } from './deckDef';

const body = (atk: number, def: number, piercing = false): number => unitDc(atk, def, piercing);

/**
 * Captain Rhodan. Deliberately the plainest leader in the pool: mid ATK, one aura, one cheap
 * active, no terrain painting and no trigger engine.
 *
 * The passive is the POSITIONAL aura unlocked in phase 3 (`AdjacentFriendlies`), which teaches the
 * single most important habit in the game — keep your leader with your line — without needing any
 * card text to say so. It is also the shape the leader-passives report wanted more of, since it
 * makes the leader's POSITION the passive rather than a global type check.
 */
export const RHODAN: LeaderDef = {
  id: 'rhodan',
  name: 'Captain Rhodan',
  type: 'Warrior',
  atk: 30,
  rules: [
    // "Forward, Together." Teaches the single most important positional habit — keep your leader
    // WITH your line — and pays it in ATK.
    //
    // ⚠ This was AuraDef in the first draft, and measurement killed that: +10 DEF around the
    // leader made a mobile fortress zone, and with the deck's own braced bodies on top of it the
    // opponent had no profitable attack anywhere. The result was 45.6% fatigue and 21.3 pass turns
    // per game — a deck that won by refusing to play, which is the worst possible lesson for a
    // starter deck. Paying the same positional habit in ATK keeps the teaching and supplies the
    // clock the deck was missing.
    {
      trigger: 'Passive',
      effect: { e: 'AuraAtk', amount: 10 },
      target: { t: 'AdjacentFriendlies' },
    },
  ],
  // The simplest useful active in the game: one body, one turn, +10 ATK. No targeting subtleties,
  // no duration to track beyond "this turn". 2 SP so it is affordable on the turn you also summon.
  ability: {
    id: 'giveTheOrder', name: 'Give the Order', cost: 2, located: true,
    effects: [{
      effect: { e: 'ApplyStatus', status: 'AtkMod', amount: 10, duration: { kind: 'endOfTurn' } },
      target: { t: 'ChosenUnit' },
    }],
  },
};

export const IRONHOLD_CARDS: Record<string, CardDef> = {
  // --- THE CURVE. One body per level, so playing the deck IS the SP lesson: your income grows
  // and you walk up this ladder. Every one is stance-ambivalent. ---

  levyRecruit: {
    // Level 1. The first card a new player ever plays. Vanilla on purpose: it teaches
    // move-is-attack and the summon zone and NOTHING else.
    kind: 'unit', id: 'levyRecruit', name: 'Levy Recruit', type: 'Warrior',
    level: 1, atk: 20, def: 15, dc: body(20, 15),
    keywords: [], rules: [],
  },
  stonecutter: {
    // Level 1, Terra. The other half of the opening: both of the deck's types appear at the very
    // bottom of the curve, so a player meets Warrior AND Terra on turn one. Slightly tougher and
    // slightly weaker than the Levy Recruit (15/20 against its 20/15) — the first hint that the two
    // stats trade off, shown by two cards that cost exactly the same.
    kind: 'unit', id: 'stonecutter', name: 'Stonecutter', type: 'Terra',
    level: 1, atk: 15, def: 20, dc: body(15, 20),
    keywords: [], rules: [],
  },
  shieldbearer: {
    // Level 2. The first body where bracing is a real option: 20 DEF against the field's level-2
    // attackers is a genuine wall for a turn, and the numbers are small enough that getting the
    // call wrong is survivable. This is where the stance lesson starts.
    //
    // ⚠ GAINED `Guard` 2026-08-09, and it belongs here more than anywhere: the deck's axis is the
    // brace/swing decision, and a brace that the enemy can simply WALK AROUND is not a decision at
    // all. Guard is the sentence that makes holding a tile mean something. It is also the one new
    // rule a beginner genuinely needs, because it is the rule that explains why position matters.
    kind: 'unit', id: 'shieldbearer', name: 'Shieldbearer', type: 'Warrior',
    level: 2, atk: 25, def: 20, dc: body(25, 20) + 1, // +1: Guard
    keywords: ['Guard'], rules: [],
  },
  quarryhand: {
    // Level 2, Terra. The terrain lesson: a Terra body on Mountain is +10, and since 2026-08-06
    // also +1 movement. Same cost as the Shieldbearer, so the comparison is clean — the player
    // learns terrain by noticing the same card performs differently on different ground.
    kind: 'unit', id: 'quarryhand', name: 'Quarryhand', type: 'Terra',
    level: 2, atk: 20, def: 20, dc: body(20, 20),
    keywords: [], rules: [],
  },
  linebreaker: {
    // Level 3. The flanking lesson: two of these beside a target beat one in front of it — flanking
    // needs no card text, it is a rule of the board.
    //
    // ⚠ GAINED `Piercing` 2026-08-09, and the card was already named for the job. This deck's FIRST
    // stated weakness has always been "Piercing ignores defense outright — Piercer is built on it",
    // and that counter lived only in a probe deck: measured across all 72 ordered matchups, 35.4%
    // of every kill in the game produces zero LP because the defender braced, and Piercing tramples
    // meta-wide were **0**. A deck whose axis is the stance decision should hold both halves of it.
    kind: 'unit', id: 'linebreaker', name: 'Linebreaker', type: 'Warrior',
    level: 3, atk: 30, def: 25, dc: body(30, 25, true),
    keywords: ['Piercing'], rules: [],
  },
  stoneSentinel: {
    // Level 4, Terra. The overflow lesson: 40 ATK beats most level-3 bodies by a MARGIN, and the
    // margin bleeds their leader. The first time a player wins a fight and sees LP move, it is
    // usually this card.
    kind: 'unit', id: 'stoneSentinel', name: 'Stone Sentinel', type: 'Terra',
    level: 4, atk: 40, def: 30, dc: body(40, 30),
    keywords: [], rules: [],
  },
  ironholdVeteran: {
    // Level 4, Warrior. The cleanest statement of the axis: 35/30 is close enough that the posture
    // is decided by what the board is doing rather than by the card. Deliberately NOT 35/35 — see
    // the leader's note; braced bodies at parity with their own ATK made the deck unbreakable.
    kind: 'unit', id: 'ironholdVeteran', name: 'Ironhold Veteran', type: 'Warrior',
    level: 4, atk: 35, def: 30, dc: body(35, 30),
    keywords: [], rules: [],
  },
  ironholdChampion: {
    // Level 5, the top of the curve and the reason to save SP. Named, so a 2-of by the blueprint's
    // rarity rule — and a beginner meeting one big card is better than meeting three.
    kind: 'unit', id: 'ironholdChampion', name: 'Ironhold Champion', type: 'Warrior',
    level: 5, atk: 50, def: 35, dc: body(50, 35),
    keywords: [], rules: [],
  },

  // --- THE FOUR CARDS WITH TEXT. One line each, one lesson each. ---

  wallwardenBrant: {
    // NAMED (2). THE GRADUATION CARD, and the first content in the game to use `OnDefend`.
    // Lesson: being attacked can be a GOOD thing. Brace him, get attacked, and he grows — which
    // inverts the beginner instinct that defending is what you do when you are losing.
    kind: 'unit', id: 'wallwardenBrant', name: 'Wallwarden Brant', type: 'Terra',
    level: 3, atk: 25, def: 30, dc: body(25, 30) + 1, // +1: the OnDefend payoff
    keywords: [],
    rules: [{
      trigger: 'OnDefend',
      effect: { e: 'AddCounter', track: 'atk', amount: 1 },
      target: { t: 'Self' },
    }],
  },
  bracedPikeman: {
    // Lesson: the brace is worth something beyond surviving. Reads "while braced, +10 DEF", which
    // is the simplest possible sentence that makes the stance decision pay.
    kind: 'unit', id: 'bracedPikeman', name: 'Braced Pikeman', type: 'Warrior',
    level: 3, atk: 25, def: 25, dc: body(25, 25) + 1, // +1: the conditional self-aura
    keywords: [],
    rules: [{
      trigger: 'Passive',
      effect: { e: 'AuraDef', amount: 10 },
      target: { t: 'Self' },
      condition: { k: 'InDefenseStance' },
    }],
  },
  cairnMason: {
    // Lesson: terrain is something you MAKE, not just something you find. One tile, its own tile,
    // on arrival — the smallest possible statement of the game's signature mechanic.
    kind: 'unit', id: 'cairnMason', name: 'Cairn Mason', type: 'Terra',
    level: 3, atk: 25, def: 25, dc: body(25, 25) + 1, // +1: OnSummon paint
    keywords: [],
    rules: [{
      trigger: 'OnSummon',
      effect: { e: 'PaintTerrain', terrain: 'Mountain' },
      target: { t: 'ThisTile' },
    }],
  },
  watchfulScout: {
    // Lesson: springs are the objective. The only card in the deck that mentions them, and it says
    // the quiet part out loud — taking the middle pays.
    kind: 'unit', id: 'watchfulScout', name: 'Watchful Scout', type: 'Warrior',
    level: 2, atk: 20, def: 20, dc: body(20, 20) + 1, // +1: OnCapture draw
    keywords: [],
    rules: [{
      trigger: 'OnCapture',
      effect: { e: 'Draw', n: 1 },
      target: { t: 'Self' },
    }],
  },

  // --- TWO SPELLS. Both global, both unconditional, both one line. ---

  rallyTheRanks: {
    // The simplest buff in the pool. Teaches that spells cost SP and that a swing turn can be
    // bought. No targeting at all — it hits your whole line.
    kind: 'spell', id: 'rallyTheRanks', name: 'Rally the Ranks', dc: 2, sp: 2, scope: 'global',
    effects: [{
      effect: { e: 'ApplyStatus', status: 'AtkMod', amount: 5, duration: { kind: 'endOfTurn' } },
      target: { t: 'FriendlyOfTypes', types: ['Warrior', 'Terra'] },
    }],
  },
  quarrymansWages: {
    // Teaches the card economy: spend some SP, draw cards. The counterweight to a deck that would
    // otherwise just play bodies until it ran out.
    //
    // ⚠ DRAW 1 -> DRAW 2, DC 2 -> 3 / SP 1 -> 2 (2026-08-16). At Draw 1 it was NULL-SUM by its own
    // text: spend a card, get a card, pay 1 SP for the privilege. The bots agreed — `npm run impact`
    // saw it SET 252 times and resolved 4 across 648 games, because a one-ply eval prices the swap
    // at exactly zero and setting a card at +1. That is not the bot being dim; that is the card.
    //
    // Draw 2 is the shape the pool already knows works: Take Payment, Scry the Depths and Verdant
    // Bounty are all DC 3 / SP 2 / Draw 2, and all three get cast freely. Ironhold is the starter
    // deck sitting 32 DC under the cap — this is exactly where the headroom should go, and a card
    // that reads "draw two" needs no more rules than one that reads "draw one".
    kind: 'spell', id: 'quarrymansWages', name: "Quarryman's Wages", dc: 3, sp: 2, scope: 'global',
    effects: [{ effect: { e: 'Draw', n: 2 }, target: { t: 'Self' } }],
  },
  holdTheFord: {
    /**
     * "HOLD THE FORD" — the first card in the game that knows springs exist.
     *
     * NEW 2026-08-16. `HoldsSpring` and `LeaderOnSpring` have been in the condition vocabulary
     * since the 2026-08-05 expansion with **zero users between them**, which is the strangest gap
     * in the pool: springs are the board's only objective, the whole risk loop the vault is built
     * around, the thing `evaluate()` spends a `springHold` term on — and not one card in nine decks
     * referenced them. The objective was something the bots fought over and the cards ignored.
     *
     * Ironhold is the right home twice over. Thematically it is the deck named for holding ground.
     * Pedagogically it is the STARTER deck, and a card that pays you for standing on the objective
     * teaches a beginner what the objective is — which is worth more here than a fourth vanilla body.
     *
     * ⚠ THE GROWTH IS PERMANENT, WHICH IS THE POINT AND ALSO THE RISK. `AddCounter` accumulates
     * where `AtkMod` expires, so holding the ford does not buy a turn, it buys a bigger army for
     * the rest of the game. That is the only shape that makes a slow deck WANT a contested tile.
     * Dialled deliberately low — +1 counter is +5 ATK (`COUNTER_STEP`), it needs a spring already
     * held at cast time, and at 2 copies. Cut copies before touching the amount.
     *
     * ⚠ `HoldsSpring` is CASTER-side: `conditionHolds` reads it off `ctx.owner`, not the subject,
     * so it gates the whole card rather than filtering targets. It also has to ride an effect that
     * READS conditions — `execLine` only consults `line.condition` on six effects, so the obvious
     * "draw a card while you hold a spring" is unwritable (see the guard test in content.test.ts).
     */
    kind: 'spell', id: 'holdTheFord', name: '"Hold the Ford!"', dc: 3, sp: 2, scope: 'global',
    effects: [{
      effect: { e: 'AddCounter', track: 'atk', amount: 1 },
      target: { t: 'FriendlyOfTypes', types: ['Warrior', 'Terra'] },
      condition: { k: 'HoldsSpring' },
    }],
  },
  breachTheLine: {
    /**
     * "BREACH THE LINE!" — the answer to a shield wall, on the deck that owns shield walls.
     *
     * NEW 2026-08-16, and the pool's first honest conditional `Destroy`. Every other piece of
     * removal in the game is a `Damage` number, which `applyDamage` resolves as "destroy if
     * amount >= effective ATK" — a threshold wearing a health bar's clothes. This says the quiet
     * part out loud: it removes a unit, and the price is a condition you can see and play around.
     *
     * `InDefenseStance` had exactly one user before this (`bracedPikeman`, in this same deck) and
     * was never readable from a spell at all, which meant bracing had no downside a card could
     * name. Ironhold already owns both halves of the stance axis after the 2026-08-09 pass — Guard
     * on the Shieldbearer, Piercing on the Linebreaker — so the deck that teaches you to brace is
     * the right one to teach you what bracing costs. Counterplay is total and obvious: stand up.
     *
     * WHY HERE. Ironhold is the starter deck and sits ~30 DC under the cap, which its own header
     * flags as the likeliest reason it sits last. This is where the headroom should go, and a card
     * that reads "destroy a braced enemy" needs no more rules than one that reads "draw two".
     *
     * Eval-visible, unlike the `GrantKeyword` Piercing grant that redmark.ts measured and reverted:
     * a destroyed unit is simply gone, which is the strongest signal `evaluate()` has. A one-ply bot
     * needs no new term to want this.
     */
    kind: 'spell', id: 'breachTheLine', name: '"Breach the Line!"', dc: 3, sp: 2, scope: 'global',
    effects: [{
      effect: { e: 'Destroy' },
      target: { t: 'ChosenEnemy' },
      condition: { k: 'InDefenseStance' },
    }],
  },
};

export const IRONHOLD_DECK: DeckDef = {
  id: 'ironhold',
  name: 'Ironhold (Starter)',
  leader: RHODAN,
  cards: IRONHOLD_CARDS,
  // 14 distinct cards, almost all at 3 copies — a beginner meets the same cards again and again
  // instead of 25 strangers. The two NAMED bodies sit at 2, which is the blueprint's rarity rule
  // pointing the same way as the fiction: a levy has no individuals except its champion and its
  // wallwarden.
  // ⚠ 2026-08-16, and this deck moved the most of any: it was ~24 DC under the cap, which its own
  // header flags as the likeliest reason it sits LAST on the ladder, so the unspent budget finally
  // bought something. In: `breachTheLine` x3 (destroy a braced enemy) and `holdTheFord` x2 (the
  // first card in the game that knows springs exist). Out: Quarryhand and Cairn Mason to 2 copies,
  // and the Levy Recruit entirely.
  //
  // Cutting the Recruit rather than leaving it a 1-of is the deliberate call — a singleton
  // contradicts the deck's whole "meet the same cards again and again" premise, Stonecutter already
  // covers level 1 with the better teaching contrast (15/20 against 20/15 at identical cost), and
  // 15 distinct cards is the ceiling the starter-deck property test holds. The 3-copy default now
  // survives on 10 of 15, which is that test's floor exactly — there is no room for a further
  // addition here without cutting another distinct card.
  list: [
    ...dup('stonecutter', 3),
    ...dup('shieldbearer', 3), ...dup('quarryhand', 2), ...dup('watchfulScout', 3),
    ...dup('linebreaker', 3), ...dup('bracedPikeman', 3), ...dup('cairnMason', 2),
    ...dup('wallwardenBrant', 2),
    ...dup('stoneSentinel', 3), ...dup('ironholdVeteran', 3),
    ...dup('ironholdChampion', 2),
    // Support.
    ...dup('rallyTheRanks', 3), ...dup('quarrymansWages', 3), ...dup('breachTheLine', 3),
    // 2026-08-16: the Levy Recruit pays for these — cut entirely rather than left as a 1-of,
    // because a singleton contradicts this deck's whole "see the same cards again" premise, and
    // Stonecutter covers level 1. The starter deck was 34 bodies and 6 support
    // cards, which is a lot of vanilla for a deck whose problem is that it sits ~24 DC under the
    // cap doing nothing with it — and the Recruit is the plainest body in the game.
    ...dup('holdTheFord', 2),
  ],
  fusionPool: [],
};

/**
 * ⚠ THE FROZEN A/B CONTROL — Ironhold exactly as it stood before the 2026-08-09 Guard/Piercing pass.
 *
 * Ironhold is not only the starter deck, it is the harness's CONTROL deck, chosen because it touches
 * so few subsystems that experiments struggle to perturb it. Giving it two keywords moves the
 * baseline every past result was read against, so the pre-pass list is kept here rather than left in
 * git history: an experiment that needs the old baseline can name this deck and get it.
 *
 * It is deliberately NOT in `DECKS` — it must never appear in the ladder or the deck picker, because
 * two near-identical Ironholds in a 9-deck ladder would just dilute every matchup.
 *
 * ⚠ IT MUST PIN ITS OWN `list` AND ITS OWN CARD DEFS, not inherit them. Spreading `...IRONHOLD_DECK`
 * shares `cards` and `list` BY REFERENCE, so before 2026-08-16 every future edit to the live deck
 * silently rewrote the frozen baseline — exactly the drift this export exists to prevent, and it
 * would have failed silently because nothing compares the two. That pass would have leaked a
 * `Draw 2` Quarryman's Wages and three copies of `breachTheLine` into the control. Anything the
 * live deck changes from here has to be re-pinned below.
 */
export const IRONHOLD_CLASSIC: DeckDef = {
  ...IRONHOLD_DECK,
  id: 'ironholdClassic',
  name: 'Ironhold (pre-2026-08-09 control)',
  cards: {
    ...IRONHOLD_CARDS,
    shieldbearer: {
      kind: 'unit', id: 'shieldbearer', name: 'Shieldbearer', type: 'Warrior',
      level: 2, atk: 25, def: 20, dc: unitDc(25, 20), keywords: [], rules: [],
    },
    linebreaker: {
      kind: 'unit', id: 'linebreaker', name: 'Linebreaker', type: 'Warrior',
      level: 3, atk: 30, def: 25, dc: unitDc(30, 25), keywords: [], rules: [],
    },
    // Pinned 2026-08-16: the live card went Draw 1 -> Draw 2 (DC 2 -> 3 / SP 1 -> 2).
    quarrymansWages: {
      kind: 'spell', id: 'quarrymansWages', name: "Quarryman's Wages", dc: 2, sp: 1, scope: 'global',
      effects: [{ effect: { e: 'Draw', n: 1 }, target: { t: 'Self' } }],
    },
  },
  // Pinned 2026-08-16: the pre-`breachTheLine` 40, at the old 3-copy body counts.
  list: [
    ...dup('levyRecruit', 3), ...dup('stonecutter', 3),
    ...dup('shieldbearer', 3), ...dup('quarryhand', 3), ...dup('watchfulScout', 3),
    ...dup('linebreaker', 3), ...dup('bracedPikeman', 3), ...dup('cairnMason', 3),
    ...dup('wallwardenBrant', 2),
    ...dup('stoneSentinel', 3), ...dup('ironholdVeteran', 3),
    ...dup('ironholdChampion', 2),
    ...dup('rallyTheRanks', 3), ...dup('quarrymansWages', 3),
  ],
};
