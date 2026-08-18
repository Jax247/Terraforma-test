// Deck legality: the registered decks AND the defense-mode probe decks obey the vault rules
// (40–50 cards, ≤3 copies, fusion pool separate, DC budget) — and validateDeck
// itself catches each violation class.
import { describe, expect, it } from 'vitest';
import {
  COPY_LIMIT,
  DECK_CARDS,
  DECKS,
  deckCost,
  DEFENSE_DECKS,
  initGame,
  isMineOnly,
  makeArenaBoard,
  setSpCost,
  STANDARD_DC_CAP,
  validateDeck,
  WILDGROWTH_DECK,
} from '../index';
import { DECK_TOKENS } from '../content/decks';
import { DAMAGE_FLOOR, rangeDc, unitDc } from '../content/decks/deckDef';
import { defaultDef } from '../engine';
import type { DeckDef } from '../content/decks';
import type { UnitCardDef } from '../types';

/**
 * 2026-08-04, the DEF content pass: two-stat combat became a core rule, so every registered unit
 * now prints a DEF. Costs moved only where a deck bought armour ABOVE the round(atk/2) line the
 * fallback was already giving it — which is why four of the eight did not move at all.
 *
 * The pass was used as a balance lever, deliberately and in the direction the 2026-08-03 ladder
 * asked for (dragonspire 86.5 / wildgrowth 83.5 at the top, hivebrood 25.5 / duneforged 33.0 at
 * the bottom): the strong decks print GLASS statlines, which costs 0 DC and states in stats what
 * they already were, while the cheap swarm deck spent 15 of its 20 points of headroom on armour
 * it could always afford and never had. ⚠ Every per-deck win rate on record predates this.
 */
const EXPECTED_DC: Record<string, number> = {
  // Rebuilt 2026-08-08 (overhaul #6) as the bramble maze, and the first pass with a BRING-IT-DOWN
  // mandate. 110 -> 109, but the budget moved: the Forest stat engine is gone (Briar's passive no
  // longer stacks +10 on top of the chart's +10) and the DC now buys `Wallwalk` and the OnDeath
  // thickets. Mosshide Bull was also repriced off the PRE_RUBRIC_UNDERPRICED exemption.
  // Measured: 72.2% -> 63.3% (3rd -> 4th of 9), and the number the pass actually existed to move,
  // mean EFFECTIVE ATK in play, 53.3 -> 42.2 against a field of 41.1 — from +14.4 clear of the pool
  // to parity with it.
  // 109 -> 108 (2026-08-09): setting a trap costs SP now, so Snare Vine gave back the +1 DC it
  // carried only because traps were free. Its power did not change — the price moved economies.
  wildgrowth: 108,
  // Rebuilt 2026-08-08 (overhaul #4). 110 -> 104, and DELIBERATELY under the cap: cut Raise the
  // Fallen x3 (9 DC at 4.2% uptime, a strictly worse copy of the leader ability), one of two fusion
  // cards (fusion fires 0.00/game game-wide), and Cart the Dead x3 (a sacrifice outlet the bots
  // would not cast). The freed budget bought bodies that actually fill the graveyard — and then
  // 5 ATK came back OFF every body in the curve, because a recursion deck that also has field-beating
  // stats measured 81.9%. It now fields the LOWEST printed ATK in the pool (27.7 vs 30.6) and the
  // HIGHEST effective ATK in play (43.4 vs 39.6), which is the shape the axis is supposed to have.
  gravemarch: 108,
  // Rebuilt 2026-08-08 (deck overhaul #3), and it spends the budget out to the cap. 104 -> 110:
  // stripping range-1 `Ranged` refunded nothing (rangeDc(1) is 0), so the whole +6 buys printed
  // text — seven of the fifteen cards carry a rule, five of them the Mountain trail that IS the
  // deck. The stat curve rose anyway (mean ATK 32.6 -> 37.3) because Avian bodies print DEF at or
  // under round(atk/2), where armour is free.
  skyfire: 110,
  // Rebuilt 2026-08-08 (overhaul #5) as the undertow deck: dead push/mine cards became bodies and
  // zone traps (20 bodies -> 23). ⚠ It then gave 5 ATK back across the whole curve and finished
  // UNDER the cap at 105 — at full strength it measured 82.2% and would have been the best deck in
  // the game by four points. ATK/DC 5.55 -> 6.62, mean ATK 30.3 -> 30.2, win rate 62.2% -> 68.9%.
  // 105 -> 108 (2026-08-16): + `theTideTurns` x2, the first card anywhere to use
  // `AllUnitsOnTerrain` — the deck that MAKES the Sea finally has a way to cash it in.
  //
  // ⚠ REPRICED THE SAME DAY, ON LADDER EVIDENCE. It was first paid for with a Scry the Depths and
  // an Undercurrent, and that trade measured **-4.5pp on arena and -4.7pp on gauntlet** — the same
  // sign on both boards, against a noise floor of +/-1.5pp, so it was real and it was a loss. Both
  // copies went back and the cost moved to the two slots the measurements actually condemn: one
  // Drowned Grasp (a 30-damage single-target trap, a tier `DAMAGE_FLOOR` measured killing 12% of
  // what it hits) and one Tide Priest (this deck's own "deliberately blank" filler body; two copies
  // keep the Leviathan recipe legal).
  tidecaller: 108,
  // Rebuilt 2026-08-07 (phase 7.5): armour dropped to the free line across the board, so the
  // deck fields far more ATK for slightly LESS budget. 105 -> 101.
  // 101 -> 103 (2026-08-16): + `pullItDown` x2, the first card anywhere to use `EffAtkAtLeast`.
  // Every other piece of removal in the pool kills SMALL things, so the biggest body on the board
  // was safe from all of it; the chaff deck is the right owner of the inverse. Paid for by two
  // Royal Nectar, which is arithmetically null-sum (gain 1 SP, draw 1, for 1 SP).
  hivebrood: 103,
  dragonspire: 109, // +0: every dragon prints under the line — it wins races, not ground
  // 95 -> 93 (2026-08-16, the DAMAGE_FLOOR pass): `scorchMine` came down DC 3 -> 2. It was the only
  // 30-damage card in the pool and priced a tier above the 20-damage mines; now that every one of
  // those IS 30, the premium was paying for a difference that no longer exists. Duneforged is the
  // only deck that fields it. Its two other raised cards (Sudden Interment, Backdraft) took the
  // damage rise at +1 SP and no DC — see DAMAGE_FLOOR for why the tier costs tempo, not budget.
  // 93 -> 95 (2026-08-16): + `theDebtCalled` x2, the first card anywhere to use
  // `GraveyardCountAtLeast` (and the first to use the new `AllEnemies` target). It is DEFINED in
  // gravemarch.ts, like Sudden Interment, but fielded only here — Gravemarch is the strongest deck
  // in the pool and Duneforged the second weakest, so the grind payoff goes where the grind needs
  // it. Paid for by two Stokefire; Corpse Tithe still covers the required economy slot.
  duneforged: 95,   // composed entirely of other decks' cards, so it inherits their DEF
  // 109 -> 110 on 2026-08-08, from the fusion pass: The Red Marshal was the one fusion that was
  // mis-STATTED rather than mis-fed (45 ATK, below the deck's own Ironhedge Pavise), so it went to
  // 60 and cost +1 DC. Red Mark was bottom-but-two at 33.9% and can carry it.
  redmark: 110,
  // Ironhold is the STARTER deck and sits far under the cap on purpose. DC measures power density,
  // and a deck of plain bodies with four one-line rules is genuinely cheap — spending the budget up
  // to 110 would mean adding the complexity the deck exists to avoid. Its measured win rate is
  // mid-field regardless, which is the check that actually matters.
  // 72 -> 78 (2026-08-09): Guard on the Shieldbearer and Piercing on the Linebreaker, the two
  // halves of the stance axis. Still the cheapest deck in the pool by 25 DC — the starter deck is
  // meant to have headroom, and ⚠ that headroom is also the likeliest reason it sits last.
  // 78 -> 86 (2026-08-16): acting on exactly that. `breachTheLine` x3 (destroy a BRACED enemy —
  // the pool's first conditional Destroy, and the third card to complete the stance axis this deck
  // owns) at the cost of one copy each from three bodies, plus Quarryman's Wages going Draw 1 ->
  // Draw 2 because at Draw 1 it was null-sum by its own text. Still the cheapest deck by 15 DC.
  // 86 -> 90 (2026-08-16): + `holdTheFord` x2 (`HoldsSpring` — the board's only objective had ZERO
  // card support in nine decks, and the starter deck is the right place to teach it), for the Levy
  // Recruit. Still the cheapest deck by 11 DC, and now at the 15-distinct-card ceiling.
  ironhold: 90,
};

/**
 * Every printed DC must cover its own statline's rubric floor. Card DCs are written as an
 * explicit `dc(atk, def) + n` beside the statline, so the two can silently drift apart — and did:
 * the 2026-08-04 DEF pass moved three Anvil chaff statlines and left their `dc()` arguments on
 * the old numbers, which quietly UNDER-priced the deck by 3. A premium above the floor is normal
 * and expected (that `+ n` is what buys the card's printed text); paying less than the floor is
 * always a bug.
 *
 * ⚠ PRE-RUBRIC DEBT, not an exemption anyone should extend. The six ids below are shared
 * poc.ts / simDecks.ts fixtures written before the DC rubric existed, and every one of them is a
 * DC 1 body carrying 30–45 ATK — under-priced on the ATK tier alone, with nothing to do with DEF
 * (they print none, so their premium is 0 either way). Surfaced 2026-08-04 by this test rather
 * than fixed, because correcting them costs +1 DC each in four decks and Gravemarch already sits
 * exactly on the 110 cap: repricing them is a balance pass, not a bookkeeping fix.
 */
const PRE_RUBRIC_UNDERPRICED = new Set([
  'mosshideBull', 'bonewroughtGolem', 'blazingRoc', 'cinderwingColossus', 'tidePriest',
]);

describe('printed DC covers the rubric floor', () => {
  for (const deck of [...DECKS, ...DEFENSE_DECKS]) {
    it(`${deck.name}: no unit is priced below its stats`, () => {
      const underpriced = [...new Set(deck.list)]
        .filter((id) => !PRE_RUBRIC_UNDERPRICED.has(id))
        .map((id) => deck.cards[id]!)
        .filter((d): d is UnitCardDef => d.kind === 'unit')
        .map((d) => ({
          id: d.id,
          dc: d.dc,
          floor: unitDc(d.atk, d.def ?? defaultDef(d.atk), d.keywords.includes('Piercing')) + rangeDc(d.range),
        }))
        .filter((x) => x.dc < x.floor);
      expect(underpriced).toEqual([]);
    });
  }
});

/**
 * Setting a trap or a mine costs SP as of 2026-08-09. The rule is only worth anything if the
 * CARDS carry a price, and a free one would look exactly like every other trap on the board — so
 * a new trap that forgets its `sp` fails here rather than quietly restoring the old economy.
 * `setSpCost` is the same function the engine charges with, so this cannot drift from the rule.
 */
describe('every registered trap and mine is priced in SP', () => {
  for (const deck of [...DECKS, ...DEFENSE_DECKS]) {
    it(`${deck.name}: no free face-down punish`, () => {
      const free = [...new Set(deck.list)]
        .map((id) => deck.cards[id]!)
        .filter((d) => d.kind === 'trap' || isMineOnly(d))
        .filter((d) => setSpCost(d) === 0)
        .map((d) => d.id);
      expect(free).toEqual([]);
    });
  }
});

/**
 * The two-stat probe decks. They are not in DECKS — they are deliberately degenerate fixtures —
 * which is exactly why they drifted illegal (6 copies of a card, Anvil over the DC cap) without
 * anything failing: nothing validated them. They are playable from the setup screen, so they
 * are held to the same deckbuild rules as the registered pool.
 */
describe('probe decks are legal too', () => {
  for (const deck of DEFENSE_DECKS) {
    it(`${deck.name}: 40 cards, ≤3 copies, DC within budget`, () => {
      expect(validateDeck(deck)).toEqual([]);
      expect(deck.list.length).toBe(40);
      const counts = new Map<string, number>();
      for (const id of deck.list) counts.set(id, (counts.get(id) ?? 0) + 1);
      expect(Math.max(...counts.values())).toBeLessThanOrEqual(COPY_LIMIT);
      for (const id of deck.list) expect(deck.cards[id], `missing def ${id}`).toBeDefined();
      expect(deckCost(deck)).toBeLessThanOrEqual(STANDARD_DC_CAP);
    });
  }

  it('each probe deck still carries the mechanic it exists to probe', () => {
    const hasKeyword = (deck: DeckDef, kw: string) =>
      [...new Set(deck.list)].some((id) => {
        const def = deck.cards[id]!;
        return def.kind === 'unit' && def.keywords.includes(kw as never);
      });
    const walls = (deck: DeckDef) =>
      deck.list.filter((id) => {
        const def = deck.cards[id]!;
        return def.kind === 'unit' && (def.def ?? 0) >= 40;
      }).length;

    const anvil = DEFENSE_DECKS.find((d) => d.id === 'anvil')!;
    const piercer = DEFENSE_DECKS.find((d) => d.id === 'piercer')!;
    // Diluting to make the copy limit must not turn the wall deck into a fair deck. Floor moved
    // 12 -> 10 on 2026-08-04: pricing DEF on its excess over round(atk/2) taxes exactly this deck,
    // and 11 walls in 40 is what the 110 cap now buys. That IS the rubric working — the budget,
    // not a test constant, is what decides how much fortress a legal deck can field.
    expect(walls(anvil)).toBeGreaterThanOrEqual(10);
    expect(hasKeyword(piercer, 'Piercing')).toBe(true);
    expect(hasKeyword(anvil, 'Piercing')).toBe(false);
  });
});

/**
 * THE DAMAGE FLOOR (2026-08-16). See `DAMAGE_FLOOR` in deckDef.ts for the measurement.
 *
 * `applyDamage` destroys a unit only when `amount >= effectiveAtk`, so a damage number is a
 * threshold and the only question is what fraction of the board sits under it. The live-board
 * median effective ATK is 40, which made the 20-damage tier a 4-10% blank across nine cards. This
 * test exists because that is invisible on the card: nothing about `{ e: 'Damage', amount: 20 }`
 * looks broken, and it took a per-card impact probe to notice that six traps and three mines were
 * doing nothing at all.
 *
 * Exceptions are allowlisted BY ID and each states its reason, in the same style as
 * PRE_RUBRIC_UNDERPRICED — a new card that wants under the floor has to argue for itself here.
 */
/**
 * AREA is the other way to beat the threshold, and the measured better one: `meteor` at 20 over a
 * 2x2 landed 0.77 kills per cast, the best of any damage card in the game, while every 20-damage
 * SINGLE-target card sat at 4-10%. Hitting four bodies with a number that beats a quarter of them
 * is not the same bet as hitting one. So the floor is scoped by TARGET SHAPE rather than by a list
 * of card ids — multiply the targets or raise the number, never both.
 */
const AREA_TARGETS = new Set([
  'AdjacentEnemies', 'Line3', 'Area2x2', 'Area3x3', 'AllUnitsOnTerrain', 'EnemiesOfTypes',
]);

/** Single-target damage allowed under the floor, each with the reason it is not removal. */
const DAMAGE_FLOOR_EXEMPT: Record<string, string> = {
  // NOT removal, and the impact probe proved it: 221 resolutions produced 5,525 LP and ZERO unit
  // kills — exactly 25.0 per cast, i.e. every copy went at a leader's face, where `applyDamage`
  // bills the raw amount and the threshold never applies at all. A burn card is priced on LP.
  dragonfire: 'leader burn',
};

describe('single-target damage clears the floor', () => {
  for (const deck of DECKS) {
    it(`${deck.name}: no single-target damage is a threshold nothing sits under`, () => {
      const tooLow: string[] = [];
      for (const id of new Set(deck.list)) {
        const def = deck.cards[id]!;
        if (DAMAGE_FLOOR_EXEMPT[id]) continue;
        const lines = def.kind === 'unit' ? def.rules : def.effects;
        for (const l of lines) {
          if (l.effect.e !== 'Damage' || AREA_TARGETS.has(l.target.t)) continue;
          if (l.effect.amount < DAMAGE_FLOOR) tooLow.push(`${id} (${l.effect.amount})`);
        }
      }
      expect(tooLow).toEqual([]);
    });
  }

  it('the exemption list stays honest', () => {
    // An exemption for a card that was deleted, or that has since been raised over the floor, is
    // dead weight that would silently cover a future regression.
    for (const id of Object.keys(DAMAGE_FLOOR_EXEMPT)) {
      const def = DECK_CARDS[id];
      expect(def, `${id} is exempted but no longer exists`).toBeDefined();
      const lines = def!.kind === 'unit' ? def!.rules : def!.effects;
      const under = lines.some((l) => l.effect.e === 'Damage' && l.effect.amount < DAMAGE_FLOOR);
      expect(under, `${id} is exempted but is no longer under the floor`).toBe(true);
    }
  });

  it('the nine cards the floor was written for are actually at it', () => {
    // Named explicitly so a future edit that quietly drops one back to 20 fails HERE, with the
    // reason attached, rather than only tripping the generic sweep above.
    const raised = [
      'thornburstMine', 'boneOrchard', 'flareMine', 'upthrust', 'drownedGrasp',
      'stingerAmbush', 'scorchingScales', 'suddenInterment', 'backdraft', 'scorchMine',
    ];
    for (const id of raised) {
      const def = DECK_CARDS[id]!;
      const lines = def.kind === 'unit' ? def.rules : def.effects;
      const dmg = lines.find((l) => l.effect.e === 'Damage');
      expect(dmg, `${id} no longer deals damage`).toBeDefined();
      expect(dmg!.effect.e === 'Damage' && dmg!.effect.amount, id).toBe(DAMAGE_FLOOR);
    }
  });
});

/**
 * ⚠ A CONDITION ON THE WRONG EFFECT IS DEAD TEXT, AND NOTHING ELSE CATCHES IT.
 *
 * `execLine` calls `targetConditionHolds` in exactly six branches. Every other effect resolves
 * without ever looking at `line.condition`, so writing one there is silently unconditional — the
 * card reads as gated and behaves as ungated. That is the same defect class as the leader rules
 * with no dispatch site (`validateCardRules`) and the inert card auras it rejects, except that
 * `validateCardRules` returns `[]` for spells and traps, so it cannot see this one at all.
 *
 * It is a live design constraint, not a hypothetical: "draw two while you hold a spring" is
 * unwritable today, because `Draw` ignores conditions. A card that wants a caster-side gate has to
 * hang it on an effect from this set.
 */
const CONDITION_AWARE_EFFECTS = new Set([
  // Gated in `execLine`, via `targetConditionHolds`.
  'Damage', 'Destroy', 'ApplyStatus', 'AddCounter', 'GrantKeyword', 'GrantWallPass',
  // ⚠ Gated on a SECOND, entirely separate path. Passive auras never reach `execLine` at all —
  // they are re-read every time a stat is computed, so their conditions live in `effectiveAtk`
  // and `effectiveDef` in stats.ts. Grepping `execLine` alone says these are unconditional and
  // that is wrong; conditional DEF auras in particular went live 2026-08-04.
  'AuraAtk', 'AuraAtkPerCount', 'AuraDef',
]);

describe('no card carries a condition an effect will ignore', () => {
  it('every registered condition sits on an effect that actually reads it', () => {
    const dead: string[] = [];
    for (const deck of [...DECKS, ...DEFENSE_DECKS]) {
      for (const id of new Set(deck.list)) {
        const def = deck.cards[id]!;
        const lines = def.kind === 'unit' ? def.rules : def.effects;
        for (const l of lines) {
          if (l.condition && !CONDITION_AWARE_EFFECTS.has(l.effect.e)) {
            dead.push(`${id}: ${l.condition.k} on ${l.effect.e}`);
          }
        }
      }
      for (const l of deck.leader.ability.effects) {
        if (l.condition && !CONDITION_AWARE_EFFECTS.has(l.effect.e)) {
          dead.push(`${deck.leader.id} ability: ${l.condition.k} on ${l.effect.e}`);
        }
      }
    }
    expect([...new Set(dead)]).toEqual([]);
  });

  it('the allowlist matches the effects execLine actually gates — a Damage condition bites', () => {
    // Pins the claim rather than trusting the comment: if someone adds a `targetConditionHolds`
    // call to another branch, or removes one, this pair is what should be re-read.
    const s = initGame({
      board: makeArenaBoard(), cardDefs: DECK_CARDS, tokenDefs: DECK_TOKENS,
      players: [
        { leader: WILDGROWTH_DECK.leader, deck: [...WILDGROWTH_DECK.list], fusionPool: [] },
        { leader: WILDGROWTH_DECK.leader, deck: [...WILDGROWTH_DECK.list], fusionPool: [] },
      ],
    });
    expect(CONDITION_AWARE_EFFECTS.has('Destroy')).toBe(true);
    expect(CONDITION_AWARE_EFFECTS.has('Draw')).toBe(false);
    expect(s.phase).toBe('action');
  });
});

describe('registered decks are legal', () => {
  for (const deck of DECKS) {
    it(`${deck.name}: 40 cards, ≤3 copies, valid fusion pool, DC within budget`, () => {
      expect(validateDeck(deck)).toEqual([]);
      expect(deck.list.length).toBe(40);
      const distinct = new Set(deck.list);
      expect(distinct.size).toBeGreaterThanOrEqual(14);
      for (const id of deck.list) expect(DECK_CARDS[id], `missing def ${id}`).toBeDefined();
      expect(deckCost(deck)).toBe(EXPECTED_DC[deck.id]);
      expect(deckCost(deck)).toBeLessThanOrEqual(STANDARD_DC_CAP);
    });
  }

  it('every deck fields at least one trap and one draw/economy piece', () => {
    for (const deck of DECKS) {
      const defs = [...new Set(deck.list)].map((id) => deck.cards[id]!);
      // Ironhold is exempt from the trap requirement BY DESIGN: it is the starter deck, and a
      // face-down card is hidden information — an advanced rule a first-time player should not
      // meet. The same omission is what makes it a stable A/B control, since a deck that touches
      // few subsystems is hard for an experiment to perturb. Every OTHER deck must still field one.
      if (deck.id !== 'ironhold') {
        expect(defs.some((d) => d.kind === 'trap'), `${deck.name} has no trap`).toBe(true);
      }
      const hasEconomy = defs.some(
        (d) => d.kind === 'spell' && d.effects.some((l) => l.effect.e === 'Draw' || l.effect.e === 'GainSP'),
      );
      expect(hasEconomy, `${deck.name} has no draw/economy spell`).toBe(true);
    }
  });

  it('intended mines read as mines (set-only), located paint spells do not', () => {
    // whirlpoolMine dropped 2026-08-08: a mine can never be sprung by displacement (a shove
    // cannot land a victim on an occupied tile), so it could not join Tidecaller's kill zone.
    for (const id of ['thornburstMine', 'scorchMine', 'flareMine']) {
      expect(isMineOnly(DECK_CARDS[id]!), `${id} should be a mine`).toBe(true);
    }
    for (const id of ['verdantSurge', 'risingTide', 'scorchedEarth', 'meteor']) {
      expect(isMineOnly(DECK_CARDS[id]!), `${id} should not be a mine`).toBe(false);
    }
  });

  it('a mirror match initializes cleanly with isolated zones', () => {
    const deck = WILDGROWTH_DECK;
    const s = initGame({
      board: makeArenaBoard(),
      cardDefs: DECK_CARDS,
      tokenDefs: DECK_TOKENS,
      players: [
        { leader: deck.leader, deck: [...deck.list], fusionPool: [...deck.fusionPool] },
        { leader: deck.leader, deck: [...deck.list], fusionPool: [...deck.fusionPool] },
      ],
    });
    expect(s.players[0].deck).not.toBe(s.players[1].deck);
    expect(s.players[0].hand.length).toBe(6); // starting 5 + P0's first turn draw at init
    expect(s.players[1].hand.length).toBe(5);
  });
});

describe('validateDeck catches violations', () => {
  const base = DECKS[0]!;
  const broken = (mutate: (d: DeckDef) => void): DeckDef => {
    const copy: DeckDef = { ...base, list: [...base.list], fusionPool: [...base.fusionPool], cards: { ...base.cards } };
    mutate(copy);
    return copy;
  };

  it('flags a 4th copy', () => {
    const d = broken((x) => { x.list[x.list.length - 1] = 'thornfang'; }); // thornfang is a 3-of
    expect(validateDeck(d).some((v) => v.includes(`${COPY_LIMIT}-copy limit`))).toBe(true);
  });

  it('flags an undersized deck', () => {
    const d = broken((x) => { x.list = x.list.slice(0, 39); });
    expect(validateDeck(d).some((v) => v.includes('deck size'))).toBe(true);
  });

  it('flags an unknown id', () => {
    const d = broken((x) => { x.list[0] = 'noSuchCard'; });
    expect(validateDeck(d).some((v) => v.includes('unknown card id'))).toBe(true);
  });

  it('flags a fusion card smuggled into the main deck', () => {
    const d = broken((x) => { x.list[0] = 'apexPredator'; });
    expect(validateDeck(d).some((v) => v.includes('fusion pool, not the main deck'))).toBe(true);
  });

  it('flags a fusion card whose material is missing from the list', () => {
    // Repointed off mosshideBull 2026-08-08: the fusion pass re-cut Apex Predator's recipe to
    // thornfang + packRunner, so the Bull is no longer a material.
    const d = broken((x) => { x.list = x.list.filter((id) => id !== 'packRunner'); });
    expect(validateDeck(d).some((v) => v.includes('material packRunner missing'))).toBe(true);
  });

  it('flags a deck over the DC cap', () => {
    const d = broken((x) => {
      const thornfang = x.cards['thornfang']!;
      x.cards = { ...x.cards, thornfang: { ...thornfang, dc: 50 } };
    });
    expect(validateDeck(d).some((v) => v.includes('exceeds the Standard cap'))).toBe(true);
  });
});
