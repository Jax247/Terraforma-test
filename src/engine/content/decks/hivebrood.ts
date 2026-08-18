// Hivebrood — Brood Matron. Insect swarm. REBUILT 2026-08-07 (phase 7.5).
//
// ---------------------------------------------------------------------------
// Axis: CONSUMPTION — the hive eats its own chaff to grow.
// Verbs: spawn · feed · grow · swarm.
// ---------------------------------------------------------------------------
//
// ⚠ Blueprint rule 1 check, because Gravemarch also "does attrition": **Gravemarch RECURS, this
// deck COMPOUNDS.** Recursion hands the body back where it was; compounding never returns it but
// leaves the survivors permanently larger. Different engines, and visibly different boards — a
// Gravemarch board rebuilds itself, a Hivebrood board gets smaller and angrier.
//
// WHY IT WAS REBUILT. At 28.6% it was the worst deck by 8.2pp, and `npm run diagnose -- hivebrood`
// named the cause: **5.67 ATK per DC against a field average of 7.39**, and **2.0 level-5+ bodies
// against 4.3**. It was spending a full budget (105 DC) on armour and dead text.
//
//   · `venomSpitter` fired 0.02 ranged attacks per GAME over 48 games — three slots of nothing.
//   · `tunnelerGrub` was 10 ATK, the weakest body in any registered deck.
//   · `bulwarkBeetle` was 30/45 for 4 DC — a wall, in a deck that does not hold ground.
//
// THE FIX IS STRUCTURAL, not a nudge: DEF now sits at or under `round(atk/2)` on every body, which
// is FREE under `unitDc`. A 45/25 raider costs 2 DC where the old 30/45 wall cost 4. The deck says
// plainly what it is — insects trade, they do not hold — and the freed budget buys ATK and a real
// top end.
//
// ⚠ TWO EARLIER DIAGNOSES OF MINE WERE WRONG, recorded so they are not repeated:
//   1. "Overflow makes chump-blocking bleed our own LP." Only in ATTACK stance. A BRACED token
//      (DEF 8) dies conceding nothing unless the attacker Pierces. The counterplay was always in
//      the rules; it just costs each token its action.
//   2. "The non-token flanking exclusion is the core problem." The diagnostic says stat
//      efficiency was, by a wide margin.
//
// STATED WEAKNESS (a rule, not a vibe): the engine needs bodies to DIE, so an opponent who
// declines to trade starves it — and `RULES.tokenCap` (5) hard-caps how fast it can feed itself.

import type { CardDef, LeaderDef, TokenDef } from '../../types';
import { dup, unitDc, type DeckDef } from './deckDef';

const body = (atk: number, def: number): number => unitDc(atk, def);

export const HIVEBROOD_TOKENS: Record<string, TokenDef> = {
  swarmling: { id: 'swarmling', name: 'Swarmling', type: 'Insect', atk: 15, keywords: [] },
};

/**
 * Deliberately LOW leader ATK — the vault's "leader's fixed attack = anti-swarm rating" finding,
 * probed from the swarm's own side: Matron cannot defend herself the way a stat-leader can, so the
 * hive has to.
 *
 * The Deathwatch is the rebuild's thesis printed on the leader: the hive feeds the queen. It keeps
 * the flat tribal aura alongside it — that aura is load-bearing for a deck of small bodies, and
 * this deck needed MORE power, not a swap.
 */
export const BROOD_MATRON: LeaderDef = {
  id: 'broodMatron', name: 'Brood Matron', type: 'Insect', atk: 15,
  rules: [
    { trigger: 'StartOfTurn', effect: { e: 'SummonToken', tokenId: 'swarmling', count: 1 }, target: { t: 'EmptyTileNear' } },
    { trigger: 'Passive', effect: { e: 'AuraAtk', amount: 5 }, target: { t: 'FriendlyOfTypes', types: ['Insect'] } },
    // "The Hive Feeds Her." Every friendly death — and this deck's bodies die constantly, by
    // design — is a point of tempo back. Turns the swarm's own attrition into an engine instead
    // of a cost, which is the whole rebuild in one line.
    {
      trigger: 'OnAllyDeath',
      effect: { e: 'GainSP', n: 1 },
      target: { t: 'Self' },
      when: { scope: 'friendly' },
    },
  ],
  ability: {
    id: 'hatch', name: 'Hatch', cost: 4, located: true,
    effects: [{ effect: { e: 'SummonToken', tokenId: 'swarmling', count: 2 }, target: { t: 'AdjacentEmptyTiles' } }],
  },
};

export const HIVEBROOD_CARDS: Record<string, CardDef> = {
  // --- THE SWARM. Every body prints DEF at or under round(atk/2), so armour costs nothing and
  // the whole budget buys ATK. This is what moves ATK-per-DC off 5.67. ---

  broodTender: {
    // Replaces Tunneler Grub (10/20 for 2 DC — the weakest body in any registered deck). Same
    // slot, +15 ATK, half the cost.
    kind: 'unit', id: 'broodTender', name: 'Brood Tender', type: 'Insect',
    level: 1, atk: 25, def: 10, dc: body(25, 10),
    keywords: [], rules: [],
  },
  frenziedDrone: {
    // Frenzy is the locked redefinition (+5 per adjacent ally, max +20) — the swarm keyword that
    // literally pays for standing shoulder to shoulder. 25 -> 30 ATK is FREE in DC because the
    // DEF stayed under the line.
    kind: 'unit', id: 'frenziedDrone', name: 'Frenzied Drone', type: 'Insect',
    level: 2, atk: 30, def: 15, dc: body(30, 15),
    keywords: ['Frenzy'], rules: [],
  },
  broodSplitter: {
    // Dying IS the plan: two more bodies, which then feed the Deathwatch engine themselves.
    kind: 'unit', id: 'broodSplitter', name: 'Brood Splitter', type: 'Insect',
    level: 2, atk: 30, def: 15, dc: body(30, 15) + 1, // +1: OnDeath token spawn
    keywords: [],
    rules: [{ trigger: 'OnDeath', effect: { e: 'SummonToken', tokenId: 'swarmling', count: 2 }, target: { t: 'AdjacentEmptyTiles' } }],
  },
  carrionMaw: {
    // THE ENGINE, and the first content in the game to use permanent counters (phase 4). Every
    // friendly death makes it permanently bigger — so the chaff the deck throws away is not spent,
    // it is INVESTED. This is precisely what "compounds" rather than "recurs" means.
    kind: 'unit', id: 'carrionMaw', name: 'Carrion Maw', type: 'Insect',
    level: 3, atk: 30, def: 15, dc: body(30, 15) + 1, // +1: the Deathwatch scaler
    keywords: [],
    rules: [{
      trigger: 'OnAllyDeath',
      effect: { e: 'AddCounter', track: 'atk', amount: 1 },
      target: { t: 'Self' },
      when: { scope: 'friendly' },
    }],
  },
  hiveHerald: {
    // Mobility for the flood: the swarm's problem is arriving together, not existing.
    kind: 'unit', id: 'hiveHerald', name: 'Hive Herald', type: 'Insect',
    level: 3, atk: 30, def: 15, dc: body(30, 15) + 1, // +1: OnSummon team movement
    keywords: [],
    rules: [{ trigger: 'OnSummon', effect: { e: 'GrantMove', tiles: 1 }, target: { t: 'FriendlyOfTypes', types: ['Insect'] } }],
  },
  hiveWarden: {
    // The graveyard scaler, kept but re-costed: 35/35 for 4 DC became 40/20 for 3. Same job,
    // far better rate — and the armour it shed is armour a swarm never wanted.
    kind: 'unit', id: 'hiveWarden', name: 'Hive Warden', type: 'Insect',
    level: 4, atk: 40, def: 20, dc: body(40, 20) + 1, // +1: the scaling self-aura
    keywords: [],
    rules: [{
      trigger: 'Passive',
      effect: { e: 'AuraAtkPerCount', amount: 5, count: { c: 'TypeInOwnGraveyard', type: 'Insect' } },
      target: { t: 'Self' },
    }],
  },
  ravenerPrime: {
    // NEW. The missing top end — the diagnostic flagged 2.0 level-5+ bodies against a field of
    // 4.3, and a deck with no ceiling cannot punish the board it builds. A lean 50/25 is only
    // 3 DC precisely because it wears no armour.
    kind: 'unit', id: 'ravenerPrime', name: 'Ravener Prime', type: 'Insect',
    level: 5, atk: 50, def: 25, dc: body(50, 25),
    keywords: [], rules: [],
  },
  duneQueen: {
    kind: 'unit', id: 'duneQueen', name: 'Dune Queen', type: 'Insect',
    level: 6, sp: 8, atk: 50, def: 25, dc: body(50, 25) + 1, // +1: OnSummon token spawn
    keywords: [],
    rules: [{ trigger: 'OnSummon', effect: { e: 'SummonToken', tokenId: 'swarmling', count: 2 }, target: { t: 'AdjacentEmptyTiles' } }],
  },

  venomSpitter: {
    // ⚠ NOT in Hivebrood's list any more — it fired 0.02 ranged attacks per GAME across 48 games,
    // three slots of nothing. The DEF is kept only because **Duneforged imports this registry**
    // and fields three copies as its Desert-favoured chip. That is a different deck with a
    // different board plan, and its ranged uptime has never been measured, so removing the card
    // outright would silently change a deck this pass is not about.
    // ⚠ DC stays the literal 2 it was printed at, NOT `body(20, 10)` (whose floor is 1). Re-pricing
    // it through the helper would quietly move Duneforged's budget by 3 and change a deck this
    // pass is not touching. A premium over the rubric floor is legal and this one is load-bearing.
    kind: 'unit', id: 'venomSpitter', name: 'Venom Spitter', type: 'Insect',
    level: 2, atk: 20, def: 10, dc: 2,
    keywords: ['Ranged'], rules: [],
  },

  // --- SPELLS ---

  feedTheHive: {
    // The sacrifice outlet, and the reason phase 7.5a added `IsToken`. The leader spawns a free
    // Swarmling every turn into a cap of 5, so the surplus simply fizzles — this converts that
    // waste into cards and tempo, and feeds the Deathwatch engine on the way.
    // ⚠ `ChosenFriendly`, not `ChosenUnit` (fixed 2026-08-08). Conditions never see ownership —
    // `targetConditionHolds` passes only the subject and the caster — so `IsToken` alone let this
    // "sacrifice your own chaff" card destroy an ENEMY token. The friendly target spec, added for
    // Gravemarch's sacrifice outlets, is the fix.
    kind: 'spell', id: 'feedTheHive', name: 'Feed the Hive', dc: 2, sp: 1, scope: 'global',
    effects: [
      { effect: { e: 'Destroy' }, target: { t: 'ChosenFriendly' }, condition: { k: 'IsToken' } },
      { effect: { e: 'Draw', n: 1 }, target: { t: 'Self' } },
      { effect: { e: 'GainSP', n: 2 }, target: { t: 'Self' } },
    ],
  },
  suddenHatch: {
    kind: 'spell', id: 'suddenHatch', name: 'Sudden Hatch', dc: 2, sp: 3, scope: 'located',
    effects: [{ effect: { e: 'SummonToken', tokenId: 'swarmling', count: 3 }, target: { t: 'AdjacentEmptyTiles' } }],
  },
  swarmCall: {
    // The anthem burst closer — one-turn +10 to the whole hive.
    kind: 'spell', id: 'swarmCall', name: 'Swarm Call', dc: 3, sp: 3, scope: 'global',
    effects: [{
      effect: { e: 'ApplyStatus', status: 'AtkMod', amount: 10, duration: { kind: 'endOfTurn' } },
      target: { t: 'FriendlyOfTypes', types: ['Insect'] },
    }],
  },
  pullItDown: {
    /**
     * "PULL IT DOWN" — the swarm's answer to something it cannot out-stat: numbers.
     *
     * NEW 2026-08-16, and the first card in the game to use `EffAtkAtLeast`. That condition was
     * added in the 2026-08-05 vocabulary expansion explicitly as the "mirror of `EffAtkAtMost`,
     * which only reads downward" — and then nothing ever read upward. Every piece of removal in the
     * pool kills SMALL things: `Damage` destroys only when it meets or beats effective ATK, so the
     * bigger a body is the safer it is from literally every removal card printed. Nothing in the
     * game punished being the biggest thing on the board.
     *
     * This is the exact inverse, and it belongs to the chaff deck. A swarm's whole fantasy is
     * dogpiling a giant, and mechanically this deck has the worst possible matchup into a top end
     * it cannot trade with — it fields 15-to-50 ATK bodies against Dragonspire's apexes. So: it
     * cannot kill anything small with this, and it does not need to. It has thirty bodies for that.
     *
     * ⚠ THE THRESHOLD IS 45 AND IT IS LOAD-BEARING. The live-board median effective ATK is 40
     * (`npm run impact`), so 45 sits deliberately ABOVE the median — this hits roughly the top
     * fifth of the board and cannot be pointed at an ordinary trade. Lowering it to 40 would make
     * it a generic Destroy for 3 SP, which is a different and much stronger card.
     *
     * Counterplay is real and reads on the card: effective ATK, not printed. Anthems, terrain and
     * flanking all push a body INTO range, so the opponent chooses how exposed to be — and a
     * 45-ATK body standing off its favored terrain is safe where the same body standing on it is
     * not. Eval-visible for free: a destroyed unit is simply gone.
     */
    kind: 'spell', id: 'pullItDown', name: 'Pull It Down', dc: 3, sp: 3, scope: 'global',
    effects: [{
      effect: { e: 'Destroy' },
      target: { t: 'ChosenEnemy' },
      condition: { k: 'EffAtkAtLeast', amount: 45 },
    }],
  },
  royalNectar: {
    kind: 'spell', id: 'royalNectar', name: 'Royal Nectar', dc: 2, sp: 1, scope: 'global',
    effects: [
      { effect: { e: 'GainSP', n: 1 }, target: { t: 'Self' } },
      { effect: { e: 'Draw', n: 1 }, target: { t: 'Self' } },
    ],
  },

  // --- TRAPS ---

  stingerAmbush: {
    // 20 -> 30 damage, DC 2 -> 3 / SP 1 -> 2 (2026-08-16, DAMAGE_FLOOR).
    kind: 'trap', id: 'stingerAmbush', name: 'Stinger Ambush', dc: 2, sp: 2, interrupt: 'respond',
    trigger: { t: 'zone' },
    effects: [{ effect: { e: 'Damage', amount: 30 }, target: { t: 'TriggeringUnit' } }],
  },
  broodHardening: {
    /**
     * THE SWARM DOES NOT REPLACE ITS DEAD, IT HARDENS AROUND THEM.
     *
     * ⚠ REPLACES `hiveReprisal` (2026-08-16), which summoned two Swarmlings when a friendly was
     * attacked and was the most reliably DEAD card measured anywhere: `npm run impact` caught it
     * firing 20 times across 729 games and producing **nothing at all on 16 of them**. The cause was
     * structural and self-inflicted — it needed empty tiles adjacent to the trap AND room under
     * `RULES.tokenCap` (5), and this is the deck that fills that cap by turn three with its leader's
     * free StartOfTurn spawn. The deck's own engine turned its own trap off.
     *
     * Growth has no cap, which is the fix. `AddCounter` is PERMANENT (unlike `AtkMod`, which expires)
     * and it ACCUMULATES (unlike `Transform`, which overwrites), so every attack the opponent makes
     * into the swarm leaves the swarm bigger for the rest of the game. That is the deck's stated axis
     * — "Gravemarch RECURS, this deck COMPOUNDS" — moved onto the trap layer, where it now punishes
     * exactly the thing the deck's stated weakness names: an opponent who engages it at all.
     *
     * ⚠ `LevelAtLeast: 1` is doing real work and is not decoration. `FriendlyOfTypes` filters on
     * OWNER alone, so an ungated version would grow two things it must not:
     *   · THE LEADER. Brood Matron prints 15 ATK on purpose — the vault's "leader's fixed attack =
     *     anti-swarm rating", probed from the swarm's own side. Permanently growing her would erase
     *     a deliberate constraint, and she is `level: 0` so this excludes her.
     *   · THE TOKENS, also `level: 0`. Chaff that hardens is no longer chaff, and the consumption
     *     axis needs it to stay disposable enough to feed to `feedTheHive` and the Deathwatch.
     * So it grows the SOLDIERS, which is precisely "leaves the survivors permanently larger".
     *
     * Eval-visible, which is why this is safe where a `GrantKeyword` grant was not (see the reverted
     * Piercing experiment on redmark.ts `bodkinVolley`): counters feed `effectiveAtk` directly via
     * `atkCounters * COUNTER_STEP`, so the bot prices the result with the `unitAtk` term it already
     * has. `carrionMaw` in this same deck already grows this way off a unit trigger.
     *
     * ⚠ THE DIAL, IF THE LADDER SPIKES: this is permanent, army-wide and fielded at 3 copies, which
     * is three independent axes of snowball. Cut copies first, then `amount`.
     */
    kind: 'trap', id: 'broodHardening', name: 'Brood Hardening', dc: 2, sp: 1, interrupt: 'respond',
    trigger: { t: 'enemyAttacksFriendly' },
    effects: [{
      effect: { e: 'AddCounter', track: 'atk', amount: 1 }, // COUNTER_STEP = 5, so +5 ATK, permanent
      target: { t: 'FriendlyOfTypes', types: ['Insect'] },
      condition: { k: 'LevelAtLeast', amount: 1 },
    }],
  },

  // --- FUSION ---

  hiveTyrant: {
    // Materials re-pointed off the deleted Bulwark Beetle onto the two bodies the deck now
    // actually fields.
    kind: 'unit', id: 'hiveTyrant', name: 'Hive Tyrant', type: 'Insect',
    level: 3, atk: 70, def: 30, dc: body(70, 30), // level 3 = 1 Brood Tender + 2 Brood Splitter
    keywords: ['Frenzy'], rules: [],
    // Re-pointed off Ravener Prime (50 ATK, a 2-of) onto Brood Tender: eating 55 ATK to make 70 is a
    // gain where eating 80 was not, and the hive's cheapest chaff is what should be feeding it.
    fusion: { materials: ['broodTender', 'broodSplitter'] },
  },
};

export const HIVEBROOD_DECK: DeckDef = {
  id: 'hivebrood',
  name: 'Hivebrood',
  leader: BROOD_MATRON,
  cards: HIVEBROOD_CARDS,
  list: [
    // The swarm — lean, cheap, and numerous.
    ...dup('broodTender', 3), ...dup('frenziedDrone', 3), ...dup('broodSplitter', 3),
    // The engine.
    ...dup('carrionMaw', 3), ...dup('hiveHerald', 3), ...dup('hiveWarden', 3),
    // The top end the deck never had.
    ...dup('ravenerPrime', 2), ...dup('duneQueen', 2),
    // Fuel and payoff.
    ...dup('feedTheHive', 3), ...dup('suddenHatch', 3), ...dup('swarmCall', 3),
    // Royal Nectar 3 -> 1: it is "gain 1 SP, draw 1" for 1 SP, i.e. arithmetically null-sum, and
    // two other decks print the identical card under different names. One copy stays because the
    // deck needs an economy piece and the cycling is free; the freed slots buy an answer to the
    // top end this deck cannot trade with.
    ...dup('royalNectar', 1), ...dup('pullItDown', 2),
    // Traps.
    ...dup('stingerAmbush', 3), ...dup('broodHardening', 3),
  ],
  fusionPool: ['hiveTyrant'],
};
