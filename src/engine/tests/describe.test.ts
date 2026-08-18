// Generated card text — pins exact strings for the POC content so the
// formatter stays readable and accurate as the effect vocabulary grows.
import { describe, expect, it } from 'vitest';
import {
  defaultResolver,
  describeCard,
  describeEffect,
  describeLeader,
  describeToken,
  isMineOnly,
} from '../describe';
import { BRIAR, OSKAR, POC_CARDS, POC_TOKENS } from '../content/poc';
import { DECK_CARDS } from '../content/decks';

const names = defaultResolver(POC_CARDS, POC_TOKENS);

describe('describeCard — units', () => {
  it('OnKill paint rule (Thornfang)', () => {
    expect(describeCard(POC_CARDS['thornfang']!, names)).toEqual([
      'On Kill: paint the tile advanced onto Forest.',
    ]);
  });

  it('passive scaling aura (Grovecaller)', () => {
    expect(describeCard(POC_CARDS['grovecaller']!, names)).toEqual([
      'Passive: this unit gets +5 ATK for each Forest tile in its surrounding 8.',
    ]);
  });

  it('graveyard-count aura (Sand Revenant)', () => {
    expect(describeCard(POC_CARDS['sandRevenant']!, names)).toEqual([
      'Passive: this unit gets +5 ATK for each Undead in your graveyard.',
    ]);
  });

  it('conditional destroy (Grave Tyrant)', () => {
    expect(describeCard(POC_CARDS['graveTyrant']!, names)).toEqual([
      'On Summon: destroy a chosen enemy, if its effective ATK is 20 or less.',
    ]);
  });

  it('death token (Duneshambler)', () => {
    expect(describeCard(POC_CARDS['duneshambler']!, names)).toEqual([
      'On Death: summon 1 Husk to an empty tile nearby.',
    ]);
  });

  it('keyword gloss lines (Carrion Swarm, Sapling Sentry)', () => {
    expect(describeCard(POC_CARDS['carrionSwarm']!, names)).toEqual([
      'Frenzy — +5 ATK per orthogonally adjacent ally (max +20).',
    ]);
    expect(describeCard(POC_CARDS['saplingSentry']!, names)).toEqual([
      'Anchored — cannot be pushed or pulled.',
    ]);
  });

  it('fusion materials resolve to card names (Apex Predator)', () => {
    expect(describeCard(POC_CARDS['apexPredator']!, names)).toEqual([
      'Fusion: Thornfang + Mosshide Bull.',
    ]);
  });

  it('vanilla body gets a fallback line (Mosshide Bull)', () => {
    expect(describeCard(POC_CARDS['mosshideBull']!, names)).toEqual(['No abilities.']);
  });
});

describe('describeCard — spells and traps', () => {
  it('located line-paint spell (Verdant Surge)', () => {
    expect(describeCard(POC_CARDS['verdantSurge']!, names)).toEqual([
      'Located spell.',
      'Paint 3 tiles in a straight line Forest.',
    ]);
  });

  it('ascension transform (Wild Awakening)', () => {
    expect(describeCard(POC_CARDS['wildAwakening']!, names)).toEqual([
      'Located Ascension spell.',
      'Transform a chosen unit: ATK becomes 60; gains Frenzy.',
    ]);
  });

  it('global raise (Raise the Fallen)', () => {
    expect(describeCard(POC_CARDS['raiseTheFallen']!, names)).toEqual([
      'Global spell.',
      'Raise a chosen Undead from your graveyard.',
    ]);
  });

  it('mine spells get the set-as-mine hint (Scorch Mine)', () => {
    expect(isMineOnly(POC_CARDS['scorchMine']!)).toBe(true);
    expect(isMineOnly(POC_CARDS['verdantSurge']!)).toBe(false);
    expect(describeCard(POC_CARDS['scorchMine']!, names)).toEqual([
      'Located spell. Costs 2 SP to set.',
      'Set face-down as a mine; triggers on enemy contact.',
      'Deal 30 damage to the triggering unit.',
    ]);
  });

  it('zone trap with timed status (Snare Vine)', () => {
    expect(describeCard(POC_CARDS['snareVine']!, names)).toEqual([
      'Trap — responds (the triggering action still completes).',
      "Triggers when an enemy unit enters this card's tile or its surrounding 8.",
      'Stun the triggering unit for 2 turns.',
    ]);
  });

  it('attack trap with end-of-turn debuff (Grasp of the Dead)', () => {
    expect(describeCard(POC_CARDS['graspOfTheDead']!, names)).toEqual([
      'Trap — responds (the triggering action still completes).',
      'Triggers when an enemy attacks a friendly unit.',
      'The attacking unit gets -20 ATK until end of turn.',
    ]);
  });
});

describe('describeLeader / describeToken', () => {
  it('Briar: paint trail, terrain aura, leader-anchored ability', () => {
    expect(describeLeader(BRIAR, names)).toEqual([
      'On Move: paint each tile moved through Forest.',
      'Passive: friendly Beast/Verdant units on Forest get +10 ATK.',
      "Ability: Overgrowth — 5 SP, located (within the leader's reach).",
      'Paint 3 tiles in a straight line Forest.',
    ]);
  });

  it('Oskar: desert aura, capture draw, leader-anchored ability', () => {
    expect(describeLeader(OSKAR, names)).toEqual([
      'Passive: friendly Undead units on Desert get +10 ATK.',
      'On Capture: draw 1 card.',
      "Ability: Raise — 5 SP, located (within the leader's reach).",
      'Raise a chosen Undead from your graveyard.',
    ]);
  });

  it('tokens: keyword lines or fallback', () => {
    expect(describeToken(POC_TOKENS['husk']!)).toEqual(['No abilities.']);
    expect(describeToken(POC_TOKENS['sapling']!)).toEqual(['Anchored — cannot be pushed or pulled.']);
  });
});

describe('new-deck content', () => {
  const deckNames = defaultResolver(DECK_CARDS, POC_TOKENS);

  // Repointed twice: off Gravewaker 2026-08-08 (the Gravemarch rebuild cut the husk generators),
  // then off Magma Wyrm 2026-08-09 (the Dragonspire rebuild traded its adjacent burn for Piercing).
  // ⚠ Ashen Firebrand is now the ONLY StartOfTurn card in the registered pool — if a rebuild takes
  // this one too, the trigger goes unrendered by any test rather than the test simply moving again.
  it('StartOfTurn rule renders (Ashen Firebrand)', () => {
    expect(describeCard(DECK_CARDS['ashenFirebrand']!, deckNames)).toEqual([
      'Start of Turn: deal 10 damage to all orthogonally adjacent enemies.',
    ]);
  });

  it('Piercing renders as a live rule, not an experiment', () => {
    // ⚠ It read "(experimental; inert unless the Defense experiment flag is on)" until 2026-08-09,
    // five days after two-stat combat became a CORE rule and the flag stopped existing. Nobody
    // noticed because no registered card carried Piercing to render.
    const [, keyword] = describeCard(DECK_CARDS['magmaWyrm']!, deckNames);
    expect(keyword).toMatch(/^Piercing — breaks a braced defender/);
    expect(keyword).not.toMatch(/experiment/i);
  });

  it('GainSP + Draw spell renders (Corpse Tithe)', () => {
    expect(describeCard(DECK_CARDS['corpseTithe']!, deckNames)).toEqual([
      'Global spell. Costs 1 SP to activate.',
      'Gain 2 SP (expires at end of turn).',
      'Draw 1 card.',
    ]);
  });

  // Repointed off Firebird Form 2026-08-08: the Skyfire rebuild strips `Ranged` from the deck
  // entirely, so its Ascension spell went with it. Elder Awakening is the same shape.
  it('Transform adding Ranged renders (Elder Awakening)', () => {
    expect(describeCard(DECK_CARDS['elderAwakening']!, deckNames)).toEqual([
      'Located Ascension spell. Costs 5 SP to activate.',
      'Transform a chosen unit: ATK becomes 65; gains Ranged.',
    ]);
  });

  it('every registered deck card yields at least one line', () => {
    for (const def of Object.values(DECK_CARDS)) {
      expect(describeCard(def, deckNames).length, def.id).toBeGreaterThan(0);
    }
  });
});

describe('coverage', () => {
  it('every POC card yields at least one line', () => {
    for (const def of Object.values(POC_CARDS)) {
      expect(describeCard(def, names).length).toBeGreaterThan(0);
    }
  });

  it('SummonToken pluralizes (no count>1 content exists yet)', () => {
    expect(
      describeEffect({ e: 'SummonToken', tokenId: 'husk', count: 2 }, { t: 'AdjacentEmptyTiles' }, names),
    ).toBe('summon 2 Husks to adjacent empty tiles');
  });
});
