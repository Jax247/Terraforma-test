// Wildgrowth — Briar, the Wildshepherd. Beast / Verdant. REBUILT 2026-08-08 (deck overhaul #6).
//
// ---------------------------------------------------------------------------
// Axis: TERRAIN CONSTRUCTION — the deck builds the board's TOPOLOGY, not its stat modifiers.
// Verbs: grow · wall · thread · hunt.
// ---------------------------------------------------------------------------
//
//     Wildgrowth grows brambles that only its own beasts can walk through.
//
// ⚠ CALIBRATE THAT CLAIM: measured, the deck puts down **2.2 walls in a peak game**. That is a lane
// re-cut, not a maze, and the header used to say "maze" before the numbers came in. A proactive
// wall spell (Bramblewall, Line3) was built to raise it and measured **-9.5pp** — the bot walls in
// its own Verdant half, which has no `Wallwalk` by design, so the deck's own walls hurt it more
// than the opponent. It was cut. The honest scale of this axis is "a few permanent brambles, placed
// by where you lost bodies".
//
// ⚠ THE FIRST REWORK WITH A BRING-IT-DOWN MANDATE. Wildgrowth sat 3rd at 72.2% having never been
// touched, and its curve was not the reason — ATK/DC 7.45 against a field of 7.57, mean printed ATK
// 30.4 which is EXACTLY the field average. What it actually had was this:
//
//     mean EFFECTIVE ATK in play        53.3        the field:  38.9
//
// THE ENGINE WAS A DOCUMENTED RULES DISCREPANCY. A leader's "+10 to my type on my terrain" passive
// STACKS with the terrain chart's own +10, so standing on your own paint is worth **+20**: Thornfang
// prints 30 and fought at 50 on Forest. `stats.ts` has carried the note for months — "the sim notes'
// arithmetic mostly counted a single +10" — and nothing was ever balanced around it. This deck
// painted 20% of the map and stood on it 56% of the time, for +16.6 ATK on every body.
//
// ⚠ EXACTLY THREE LEADERS CARRY THAT PASSIVE: Briar, Vharos (Dragonspire, #2) and Oskar. Only
// Briar's is fixed here, deliberately, so this rework's effect stays attributable — see the vault's
// Open Threads, where the remaining two are recorded as a live balance item.
//
// BRIAR'S PASSIVE IS NOW `InEnemyHalf`: the wild does not defend, it advances. Same +10, but it has
// to be gone and taken, which is the nerf and the identity in one line. She still paints Forest as
// she walks — that terrain now gives the chart's +10 and nothing more.
//
// WHAT REPLACES THE STAT ENGINE. No card in the game paints `Wall`, and no card anywhere carries
// `Wallwalk`. Both are live engine vocabulary that has never been used, and they are two halves of
// one idea: the brambles close the board to everything EXCEPT the things that grew them.
//
//   · Walls come from BODIES THAT DIE. `destroyUnit` fires OnDeath *after* removal, from the death
//     position, so `OnDeath -> PaintTerrain 'Wall' -> ThisTile` roots a thicket where the body fell.
//     Self-limiting by construction: one wall per body you lose, each paid for with a card. (It also
//     sidesteps a vocabulary gap — there is no "paint one chosen tile" target, and `Line3` would put
//     down three PERMANENT walls a cast.)
//   · `Wallwalk` on the Beast core is what makes a bramble an asset instead of a shared obstacle.
//     ⚠ The Verdant half does NOT have it — which is a real cost, and the measured reason a
//     proactive wall spell failed. Reactive walls are fine because they land where a body already
//     died; a chosen wall is a topology decision the bot cannot make well.
//
// ⚠ WALLS ARE PERMANENT — `RULES.wallsPaintable` is false, so nothing can ever clear one. Runtime
// wall creation is guarded in `engine.ts` (`wallWouldSeal`): a wall that would seal a leader's ring
// or cut the two sides apart is refused for that tile. `boardLayout.ts` has always enforced the same
// three rules for hand-built maps; this deck is the reason they now hold at runtime too.
//
// WHY IT DOES NOT COLLIDE WITH SKYFIRE. Skyfire's terrain buys SPEED, on ground anyone with the
// right affinity can use — its road is deliberately public. Wildgrowth's buys ACCESS, and is
// exclusive. Speed versus topology, public versus private.
//
// STATED WEAKNESSES (rules, not vibes):
//   · THE MAZE IS A COMMITMENT. Walls are permanent and cannot be unmade, so a badly placed thicket
//     is terrain you gave the opponent for free — and half your own deck cannot walk through it.
//   · THE BONUS IS IN THEIR HALF. Briar pays nothing while you hold your own ground, so the deck
//     cannot sit behind its brambles and win.
//   · IT ONLY WALLS WHERE IT LOSES. The maze is built out of casualties, so the shape of the board
//     is decided by where the deck is losing fights, not where it wants a wall.

import type { CardDef, LeaderDef } from '../../types';
import { dup, unitDc, type DeckDef } from './deckDef';

/** The shared stat rubric, so this deck's DEF is billed exactly like everyone else's. */
const body = (atk: number, def: number): number => unitDc(atk, def);

/**
 * Briar, the Wildshepherd.
 *
 * ⚠ The passive is the whole nerf. It was `+10 to Beast/Verdant on Forest`, which stacked with the
 * chart for +20 on ground she paints for free every time she moves.
 *
 * It is now a FLAT +5 to her own types, and the plainness is deliberate: two conditional drafts were
 * measured and both were nearly dead. `InEnemyHalf` paid on 13-22% of bodies against the old
 * passive's 56%, and `HasKeyword: Wallwalk` paid on the 6 of 26 bodies that ended up carrying it —
 * the deck fell to 50.3% and 48.1% respectively. A flat aura at half the old size lands ~+5 on every
 * body at 100% uptime, which is close to what the old one averaged BEFORE the chart double-counted
 * it. ⚠ Conditions need their uptime measured, not assumed.
 *
 * The deck's identity is in the brambles now, not the leader; she paints the ground and the maze
 * does the rest.
 */
export const BRIAR_WILDSHEPHERD: LeaderDef = {
  id: 'briar', name: 'Briar, the Wildshepherd', type: 'Verdant', atk: 20,
  rules: [
    {
      trigger: 'Passive',
      effect: { e: 'AuraAtk', amount: 5 },
      target: { t: 'FriendlyOfTypes', types: ['Beast', 'Verdant'] },
    },
    { trigger: 'OnMove', effect: { e: 'PaintTerrain', terrain: 'Forest' }, target: { t: 'TilesMovedThrough' } },
  ],
  ability: {
    id: 'overgrowth', name: 'Overgrowth', cost: 5, located: true,
    effects: [{ effect: { e: 'PaintTerrain', terrain: 'Forest' }, target: { t: 'Line3' } }],
  },
};

export const WILDGROWTH_CARDS: Record<string, CardDef> = {
  // --- THE THICKET. Verdant, no Wallwalk: these are what the maze is MADE of, and they cannot
  // walk through it afterwards. Where they die is where the board changes shape. ---

  saplingSentry: {
    // Anchored and dies into a wall — it cannot be dragged off the tile it intends to become.
    kind: 'unit', id: 'saplingSentry', name: 'Sapling Sentry', type: 'Verdant',
    level: 2, atk: 25, def: 20, dc: body(25, 20) + 2, // +1 Anchored, +1 the thicket it leaves
    keywords: ['Anchored'],
    rules: [{ trigger: 'OnDeath', effect: { e: 'PaintTerrain', terrain: 'Wall' }, target: { t: 'ThisTile' } }],
  },
  mossveilWarden: {
    kind: 'unit', id: 'mossveilWarden', name: 'Mossveil Warden', type: 'Verdant',
    level: 3, atk: 25, def: 15, dc: body(25, 15) + 1, // +1: the thicket it leaves
    keywords: [],
    rules: [{ trigger: 'OnDeath', effect: { e: 'PaintTerrain', terrain: 'Wall' }, target: { t: 'ThisTile' } }],
  },
  grovecaller: {
    // Its old "+5 per Forest tile around it" was the stat engine this rebuild exists to remove —
    // stand-on-your-own-paint, scaled. Now it is the third thicket, so the Verdant half of the deck
    // is uniformly what the maze is MADE of.
    kind: 'unit', id: 'grovecaller', name: 'Grovecaller', type: 'Verdant',
    level: 4, atk: 25, def: 15, dc: body(25, 15) + 1, // +1: the thicket it leaves
    keywords: [],
    rules: [{ trigger: 'OnDeath', effect: { e: 'PaintTerrain', terrain: 'Wall' }, target: { t: 'ThisTile' } }],
  },
  brambleShoot: {
    // ⚠ NOT a wall-maker — the cheap body that BUYS TIME for the ones that are. Anchored so it
    // cannot be dragged off the tile it is holding, which is the whole of its job. (An earlier
    // draft's comment called it "the cheapest thicket"; it leaves nothing behind, and the tests
    // caught the discrepancy.)
    kind: 'unit', id: 'brambleShoot', name: 'Bramble Shoot', type: 'Verdant',
    level: 1, atk: 20, def: 10, dc: body(20, 10) + 1, // +1: Anchored
    keywords: ['Anchored'], rules: [],
  },

  // --- THE PACK. Beasts with `Wallwalk` — the FIRST cards in the game to carry it. The maze is
  // only an asset because these walk through it and nothing else can. ---

  packRunner: {
    kind: 'unit', id: 'packRunner', name: 'Pack Runner', type: 'Beast',
    level: 2, atk: 25, def: 10, dc: body(25, 10) + 1, // +1: the team dash
    keywords: [],
    rules: [{ trigger: 'OnSummon', effect: { e: 'GrantMove', tiles: 1 }, target: { t: 'FriendlyOfTypes', types: ['Beast'] } }],
  },
  thornfang: {
    kind: 'unit', id: 'thornfang', name: 'Thornfang', type: 'Beast',
    level: 3, atk: 35, def: 15, dc: body(35, 15) + 1, // +1: Wallwalk
    keywords: ['Wallwalk'], rules: [],
  },
  brambleMaw: {
    kind: 'unit', id: 'brambleMaw', name: 'Bramble Maw', type: 'Beast',
    level: 4, atk: 40, def: 15, dc: body(40, 15) + 1, // +1: the arrival cull
    keywords: [],
    rules: [{
      trigger: 'OnSummon',
      effect: { e: 'Destroy' },
      target: { t: 'ChosenEnemy' },
      condition: { k: 'EffAtkAtMost', amount: 20 },
    }],
  },
  mosshideBull: {
    // ⚠ Repriced from its long-standing DC 1 to an honest floor. It was on the
    // `PRE_RUBRIC_UNDERPRICED` allowlist — a 45-ATK body for one point — and a rebuild is the right
    // moment to stop leaning on that exemption.
    kind: 'unit', id: 'mosshideBull', name: 'Mosshide Bull', type: 'Beast',
    level: 5, sp: 7, atk: 45, def: 20, dc: body(45, 20) + 1, // +1: Wallwalk
    keywords: ['Wallwalk'], rules: [],
  },
  elderhornAlpha: {
    kind: 'unit', id: 'elderhornAlpha', name: 'Elderhorn Alpha', type: 'Beast',
    level: 6, sp: 8, atk: 55, def: 20, dc: body(55, 20) + 1, // +1: Frenzy
    keywords: ['Frenzy'], rules: [],
  },

  // --- THE GROWTH. ---

  verdantSurge: {
    kind: 'spell', id: 'verdantSurge', name: 'Verdant Surge', dc: 2, sp: 1, scope: 'located',
    effects: [{ effect: { e: 'PaintTerrain', terrain: 'Forest' }, target: { t: 'Line3' } }],
  },
  verdantBounty: {
    kind: 'spell', id: 'verdantBounty', name: 'Verdant Bounty', dc: 3, sp: 2, scope: 'global',
    effects: [{ effect: { e: 'Draw', n: 2 }, target: { t: 'Self' } }],
  },
  seedburst: {
    kind: 'spell', id: 'seedburst', name: 'Seedburst', dc: 1, sp: 1, scope: 'located',
    effects: [{ effect: { e: 'SummonToken', tokenId: 'sapling', count: 1 }, target: { t: 'EmptyTileNear' } }],
  },
  wildAwakening: {
    kind: 'spell', id: 'wildAwakening', name: 'Wild Awakening', dc: 4, sp: 4, scope: 'located', ascension: true,
    effects: [{ effect: { e: 'Transform', atk: 60, addKeywords: ['Frenzy'] }, target: { t: 'ChosenUnit' } }],
  },

  // --- FIELDWORKS ---

  thornburstMine: {
    // 20 -> 30 damage, DC 2 -> 3 / SP 1 -> 2 (2026-08-16). See DAMAGE_FLOOR in deckDef.ts: at 20
    // this mine went 0 kills in 28 measured hits, because 20 damage only kills a body whose
    // EFFECTIVE ATK is 20 or less and the median body in play is 40.
    kind: 'spell', id: 'thornburstMine', name: 'Thornburst Mine', dc: 2, sp: 2, scope: 'located',
    effects: [{ effect: { e: 'Damage', amount: 30 }, target: { t: 'TriggeringUnit' } }],
  },
  snareVine: {
    // DC 4 -> 3 / SP 3 on 2026-08-09, when setting a trap started costing SP. The extra DC was
    // the 2026-08-03 stun repricing charging a trap +1 over the equivalent SPELL *because* a trap
    // paid nothing at all; now that it does, this prices exactly like Pin Down (DC 3 / SP 3).
    kind: 'trap', id: 'snareVine', name: 'Snare Vine', dc: 3, sp: 3, interrupt: 'respond',
    trigger: { t: 'zone' },
    effects: [{
      effect: { e: 'ApplyStatus', status: 'Stunned', amount: 0, duration: { kind: 'turns', turnsLeft: 2 } },
      target: { t: 'TriggeringUnit' },
    }],
  },

  // --- FUSION. Both re-pointed by the 2026-08-08 fusion pass; see `fusion.test.ts`. ---

  apexPredator: {
    kind: 'unit', id: 'apexPredator', name: 'Apex Predator', type: 'Beast',
    // 70 -> 75 when the free ATK pass raised its materials to 35 + 25: `fusion.test.ts` requires a
    // fusion to beat what it eats by 15, and it caught this immediately. Free in DC — 75 sits in the
    // same >=50 tier.
    level: 5, atk: 75, def: 30, dc: body(75, 30) + 1, // level 5 = 3 Thornfang + 2 Pack Runner; +1 Wallwalk
    keywords: ['Wallwalk'], rules: [],
    fusion: { materials: ['thornfang', 'packRunner'] },
  },
  verdantColossus: {
    kind: 'unit', id: 'verdantColossus', name: 'Verdant Colossus', type: 'Verdant',
    level: 6, atk: 75, def: 60, dc: body(75, 60) + 1, // level 6 = 4 Grovecaller + 2 Sapling Sentry; +1 Anchored
    keywords: ['Anchored'], rules: [],
    fusion: { materials: ['grovecaller', 'saplingSentry'] },
  },
};

export const WILDGROWTH_DECK: DeckDef = {
  id: 'wildgrowth',
  name: 'Wildgrowth',
  leader: BRIAR_WILDSHEPHERD,
  cards: WILDGROWTH_CARDS,
  list: [
    // The thicket — Verdant, no Wallwalk. This half IS the maze, and cannot walk through it.
    ...dup('brambleShoot', 3), ...dup('saplingSentry', 3), ...dup('mossveilWarden', 3),
    ...dup('grovecaller', 3),
    // The pack — Beasts that thread it.
    ...dup('packRunner', 3), ...dup('thornfang', 3), ...dup('brambleMaw', 3),
    ...dup('mosshideBull', 3), ...dup('elderhornAlpha', 2),
    // Growth.
    ...dup('verdantSurge', 3), ...dup('verdantBounty', 3), ...dup('seedburst', 3),
    // Fieldworks.
    ...dup('thornburstMine', 3), ...dup('snareVine', 1), ...dup('wildAwakening', 1),
  ],
  fusionPool: ['apexPredator', 'verdantColossus'],
};

/** Kept for the old export name; nothing outside this file reads it. */
export const WILDGROWTH_EXTRA_CARDS = WILDGROWTH_CARDS;
