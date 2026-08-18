// Terraforma card-art batch generator.
//
// Reads the real card registry (every leader, unit, spell, trap and token any
// registered deck references) and generates one cohesive illustration per card
// via a Flux endpoint. Cohesion comes from a shared master style plus a per-deck
// theme (biome / palette / mood) and a per-type creature descriptor, so every
// card in an archetype reads as the same world.
//
// It is INCREMENTAL: art is keyed by card id and written to public/card-art/<id>.jpg.
// Existing files are skipped, so when new cards appear during deck creation you
// just re-run this and only the newcomers are generated. Seeds are derived from
// the card id, so a regenerate reproduces the same image.
//
//   MODELS: `--model=<alias>` picks one; `--models=a,b,c` renders the SAME prompt through each and
//   files them as variants 1..N in list order, which turns the in-game picker into a model
//   bake-off. Registered aliases: flux2 (default), kontext, grok, nano — see MODELS. Each declares
//   its own request body, because fal silently IGNORES params a model does not accept rather than
//   erroring, so a wrong body yields quietly mis-shaped images instead of a failure.
//
//   Providers (pick one, set its key in the env):
//     fal.ai     (default)  ->  FAL_KEY            https://fal.ai/dashboard/keys
//     replicate            ->  REPLICATE_API_TOKEN https://replicate.com/account/api-tokens
//   Select with ART_PROVIDER=fal | replicate  (default fal).
//   Default model: FLUX 2 [pro]. Override with ART_MODEL (e.g. fal-ai/flux/dev
//   for a cheaper draft pass, or fal-ai/flux-pro/kontext/max/text-to-image).
//
//   Run:
//     node --env-file=.env scripts/genCardArt.ts            # generate missing art
//     node scripts/genCardArt.ts --dry-run                  # print prompts, no API calls, no cost
//     node scripts/genCardArt.ts --only=vharos,emberEgg     # a subset
//     node scripts/genCardArt.ts --force                    # regenerate everything
//     node scripts/genCardArt.ts --concurrency=6
//     node scripts/genCardArt.ts --variants=3               # keep 3 alternates per card
//     node scripts/genCardArt.ts --only=cairnMason --variants=4   # alternates for one card
//
// ART DIRECTION: `PROMPT_OVERRIDES` holds hand-written prompts for individual cards, used verbatim
// instead of the generated recipe. The recipe exists for COHESION across the whole set; overrides
// are for the few cards worth directing individually (leaders, a signature body).
//
// ALTERNATES: variant 1 is `<id>.jpg`, alternates are `<id>-2.jpg`, `<id>-3.jpg`, …
// Each re-rolls the whole visual recipe (pose, camera, lighting, feature), not just the
// diffusion seed, so the options are genuinely different pictures. `variants.json` indexes
// which cards have more than one, and the in-game card detail panel lets you pick.
//
// --dry-run needs no key: use it to eyeball the prompts before spending anything.

import { mkdir, readFile, readdir, writeFile, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DECKS, DECK_TOKENS } from '../src/engine/content/decks/index.ts';
import type { CardDef, LeaderDef, TokenDef, TypeName, Keyword } from '../src/engine/types.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, '..', 'public', 'card-art');
const MANIFEST = join(OUT_DIR, 'manifest.json');
const VARIANT_INDEX = join(OUT_DIR, 'variants.json');

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const has = (flag: string) => args.includes(flag);
const val = (name: string, def: string): string =>
  args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? def;

const DRY_RUN = has('--dry-run');
const FORCE = has('--force');
const CONCURRENCY = Math.max(1, parseInt(val('concurrency', '4'), 10) || 4);
const ONLY = new Set(val('only', '').split(',').map((s) => s.trim()).filter(Boolean));
// The provider's content checker is STOCHASTIC: the identical prompt at the identical seed was
// measured returning both OK and BLOCKED, and every phrase in the rejected prompts also appears in
// prompts that generated fine. So a rejection is a dice roll on a borderline prompt, not a verdict
// on a banned word — which is why retrying is worth doing at all. It is NOT sufficient on its own
// though: five cards lost 8 consecutive rolls, hence the sanitizer fallback below.
const RETRIES = Math.max(1, parseInt(val('retries', '3'), 10) || 3);
// How many ALTERNATE illustrations to hold per card. Variant 1 keeps the bare
// `<id>.jpg` name so nothing that already points at art has to change; 2..N are
// `<id>-2.jpg`, `<id>-3.jpg`. The UI reads the count from variants.json and lets
// the player pick, so generating alternates is how you get a choice worth making.
//
// ⚠ Mutually exclusive with `--models`, which derives the count from the model list instead.
// See VARIANTS below the registry.
const VARIANTS_FLAG = val('variants', '');

const PROVIDER = (process.env.ART_PROVIDER ?? 'fal').toLowerCase();
const KEY_ENV = PROVIDER === 'replicate' ? 'REPLICATE_API_TOKEN' : 'FAL_KEY';

// ---------------------------------------------------------------------------
// Model registry
// ---------------------------------------------------------------------------

/**
 * A generation endpoint and the exact request body it accepts.
 *
 * ⚠ EVERY MODEL DECLARES ITS OWN INPUT. This is not tidiness — fal SILENTLY IGNORES parameters a
 * model does not declare rather than rejecting them. Send FLUX's `image_size` to a model that wants
 * `aspect_ratio` and nothing errors: you just get square images that our 3:4 frame then crops. The
 * bodies below were built from each endpoint's published OpenAPI schema, and the only safe way to
 * add a model is to read its schema first.
 */
interface ModelSpec {
  /** fal endpoint id. */
  id: string;
  /** Human label, carried into variants.json so the picker can caption a thumbnail. */
  label: string;
  /**
   * Does the endpoint accept a seed? When false a regenerate CANNOT reproduce the image, so the
   * "seeds are derived from the card id, so a regenerate reproduces the same image" contract in
   * this file's header does not hold for it.
   */
  seeded: boolean;
  input(prompt: string, seed: number): Record<string, unknown>;
}

/** Portrait ratio the card frame expects (`aspect-ratio: 3 / 4` with `object-fit: cover`). */
const CARD_ASPECT = '3:4';

const MODELS: Record<string, ModelSpec> = {
  // The original default: every one of the existing images was generated here, so its body must
  // not drift or those cards stop being reproducible. Note `image_size`, not `aspect_ratio`.
  flux2: {
    id: 'fal-ai/flux-2-pro',
    label: 'FLUX 2 Pro',
    seeded: true,
    input: (prompt, seed) => ({
      prompt, seed, image_size: 'portrait_4_3', num_images: 1,
      output_format: 'jpeg', enable_safety_checker: false,
    }),
  },
  kontext: {
    id: 'fal-ai/flux-pro/kontext/max/text-to-image',
    label: 'Kontext Max',
    seeded: true,
    input: (prompt, seed) => ({
      prompt, seed, aspect_ratio: CARD_ASPECT, num_images: 1,
      output_format: 'jpeg', safety_tolerance: '5',
    }),
  },
  // ⚠ NO SEED PARAMETER. Grok's schema has no seed at all, so its output is not reproducible —
  // regenerating gives a different picture. Nothing here can fix that; it is a property of the API.
  grok: {
    id: 'xai/grok-imagine-image/v2.0/text-to-image',
    label: 'Grok Imagine',
    seeded: false,
    input: (prompt) => ({
      prompt, aspect_ratio: CARD_ASPECT, num_images: 1,
      output_format: 'jpeg', resolution: '2k', quality: 'medium',
    }),
  },
  nano: {
    id: 'fal-ai/nano-banana-2',
    label: 'Nano Banana 2',
    seeded: true,
    input: (prompt, seed) => ({
      prompt, seed, aspect_ratio: CARD_ASPECT, num_images: 1,
      output_format: 'jpeg', resolution: '2K', safety_tolerance: '5',
    }),
  },
};

/** Resolve a `--model=` alias, or a raw endpoint id (which falls back to the FLUX-shaped body). */
function resolveModel(name: string): ModelSpec {
  const spec = MODELS[name];
  if (spec) return spec;
  if (name.includes('/')) {
    // A raw endpoint keeps ART_MODEL working, but we have no schema for it — warn loudly, because
    // the failure mode is a silently wrong aspect ratio rather than an error.
    console.warn(`⚠ "${name}" is not a registered model; using the FLUX-shaped body. Aspect ratio may be wrong.`);
    return { ...MODELS['flux2']!, id: name, label: name };
  }
  const known = Object.keys(MODELS).join(', ');
  console.error(`Unknown model "${name}". Known aliases: ${known}. (Or pass a full endpoint id.)`);
  process.exit(1);
}

// `--models=a,b,c` runs a multi-model pass where the VARIANT INDEX IS THE POSITION IN THIS LIST,
// so variant 1 is the first model named, 2 the second, and so on. That is what makes the in-game
// picker a model comparison.
const MODEL_LIST = val('models', '').split(',').map((s) => s.trim()).filter(Boolean);
const SINGLE_MODEL = resolveModel(val('model', process.env.ART_MODEL ?? (PROVIDER === 'replicate' ? 'black-forest-labs/flux-dev' : 'flux2')));
const MODELS_IN_RUN: ModelSpec[] = MODEL_LIST.length > 0 ? MODEL_LIST.map(resolveModel) : [SINGLE_MODEL];
const MULTI_MODEL = MODEL_LIST.length > 0;

/** Which model produces variant `n`. Single-model runs use the same one for every variant. */
const modelForVariant = (n: number): ModelSpec =>
  MULTI_MODEL ? MODELS_IN_RUN[Math.min(n, MODELS_IN_RUN.length) - 1]! : SINGLE_MODEL;

// Two different meanings for the variant axis, and they cannot both hold at once: `--variants`
// means "N alternates from N different prompts", `--models` means "one prompt through N engines".
// Silently letting one win would produce a set nobody can interpret.
if (MULTI_MODEL && VARIANTS_FLAG !== '') {
  console.error('--models and --variants are mutually exclusive: --models already sets one variant per model.');
  process.exit(1);
}
const VARIANTS = MULTI_MODEL ? MODELS_IN_RUN.length : Math.max(1, parseInt(VARIANTS_FLAG || '1', 10) || 1);

// ---------------------------------------------------------------------------
// Cohesion vocabulary
// ---------------------------------------------------------------------------

// The style anchor shared by EVERY card — this is what makes the set feel like
// one game rather than 100 unrelated pictures. `human` swaps "creature art" for
// "character art" and bans the monster cues; see DECK_SPECIES.
const masterStyle = (human: boolean) =>
  `trading card game ${human ? 'character' : 'creature'} art, digital painting, dramatic cinematic lighting, ` +
  'highly detailed dark-fantasy concept art, painterly rendering, rich saturated color, ' +
  'a single clear focal subject, dynamic composition. ' +
  (human
    ? 'The subject is an ordinary human being with a human face and human proportions: ' +
      'no horns, no claws, no fangs, no tusks, no glowing eyes, no scales, no fur pelt-body, ' +
      'not an orc, not a beast-man, not a golem, not a construct, not an elemental. '
    : '') +
  'No text, no words, no card frame, no border, no UI, no watermark, no signature.';

// Per-deck world: biome / palette / mood. Borrowed cards (Duneforged reuses
// Gravemarch/Skyfire/Hivebrood cards) keep their HOME deck's theme because that
// deck is iterated first and we dedupe by id.
const DECK_THEMES: Record<string, { biome: string; palette: string; mood: string }> = {
  wildgrowth: { biome: 'a lush overgrown primeval forest, ancient roots and canopy light', palette: 'verdant greens, mossy gold, dappled sunlight', mood: 'wild, fecund, druidic' },
  gravemarch: { biome: 'a fog-wreathed graveyard over fields of bone', palette: 'sickly green, bone white, necrotic violet', mood: 'grim, decaying, funereal' },
  skyfire:    { biome: 'storm-torn skies above erupting volcanic peaks', palette: 'ember orange, ash grey, molten red', mood: 'aggressive, blazing, kinetic' },
  tidecaller: { biome: 'surging seas and crushing tidal depths', palette: 'deep teal, foam white, abyssal blue', mood: 'fluid, cold, controlling' },
  hivebrood:  { biome: 'chitinous hive tunnels and seething nests', palette: 'amber carapace, venom green, waxen ochre', mood: 'teeming, alien, relentless' },
  dragonspire:{ biome: 'colossal obsidian mountain spires wreathed in magma', palette: 'obsidian black, magma orange, dragon-scale crimson', mood: 'colossal, ancient, apex' },
  duneforged: { biome: 'scorched desert wastes over buried ruins', palette: 'sun-bleached ochre, rust, forged bronze', mood: 'harsh, convergent, weathered' },
  ironhold:   { biome: 'a grey mountain fortress and the walled grassland holdings below it', palette: 'iron grey, quarried stone, dull steel blue, faded banner red', mood: 'disciplined, dogged, dug-in' },
};
const NEUTRAL_THEME = { biome: 'a shadowed dark-fantasy battlefield', palette: 'muted earth tones with a cold rim light', mood: 'ominous, tense' };

// Monster type -> what the creature IS (a Dragon reads as a dragon, Undead as
// risen dead) with several silhouettes per type so same-type cards diverge.
const TYPE_DESC: Record<TypeName, string[]> = {
  Beast: ['a powerful feral beast', 'a hulking horned brute', 'a sinewy pack-hunting predator', 'a shaggy fanged carnivore', 'a lithe prowling great-cat', 'a broad-shouldered dire-beast'],
  Insect: ['a monstrous armored insect', 'a chitinous many-legged horror', 'a segmented burrowing arthropod', 'a venomous winged swarm-creature', 'a towering mantis-like insectoid', 'a bulbous stinger-tailed brood-thing'],
  Dragon: ['a mighty scaled dragon', 'a serpentine winged wyrm', 'a horned volcanic drake', 'an ancient plated dragon', 'a sleek four-winged wyvern', 'a crag-backed elder dragon'],
  Avian: ['a fierce winged avian creature', 'a taloned raptor of the skies', 'a storm-feathered great bird', 'a crested plumed avian', 'a razor-beaked hunting bird', 'a ragged carrion-bird'],
  Aqua: ['a sleek aquatic creature', 'a tentacled deep-sea horror', 'a finned serpentine leviathan', 'an armored crustacean beast', 'a translucent bioluminescent swimmer', 'a whiskered eel-like predator'],
  Warrior: ['an armored warrior', 'a scarred veteran soldier', 'a heavily-plated champion', 'a nimble dual-blade fighter', 'a towering brute in war-plate', 'a cloaked wandering swordsman'],
  Spellcaster: ['a robed spellcaster wreathed in arcane energy', 'a hooded conjurer trailing glyphs', 'an ornate battle-mage crackling with power', 'a gaunt sorcerer wielding raw magic', 'a masked ritualist amid floating sigils', 'a horned witch cloaked in smoke'],
  Fiend: ['a horned demonic fiend', 'a sinewy winged devil', 'a molten-veined infernal brute', 'a many-eyed shadow demon', 'a gaunt clawed nightmare', 'a hulking hell-knight'],
  Undead: ['a risen undead horror', 'a skeletal armored revenant', 'a rotting shambling corpse', 'a wraith-like spectral figure', 'a bone-and-sinew abomination', 'a crowned lich-thing'],
  Machine: ['a hulking mechanical construct', 'an angular battle automaton', 'a rusted piston-driven golem', 'a sleek arcane-powered machine', 'a multi-limbed clockwork engine', 'a siege-plated war-construct'],
  Inferno: ['a creature of living fire and molten rock', 'a blazing elemental of pure flame', 'a magma-crusted burning brute', 'a swirling firestorm given form', 'an ember-shedding infernal beast', 'a charred coal-bodied colossus'],
  Verdant: ['a creature of plant and flesh entwined', 'a towering bark-skinned ent', 'a blossoming thorned guardian', 'a vine-wreathed woodland spirit', 'a fungal overgrown behemoth', 'a gnarled root-limbed treant'],
  Terra: ['a creature of living stone and earth', 'a craggy boulder-limbed golem', 'a crystalline rock elemental', 'a moss-covered earthen guardian', 'a jagged obsidian construct', 'a sediment-layered stone titan'],
};

// A distinguishing physical detail layered onto creatures — the strongest lever
// for making two same-type cards look unmistakably different.
const FEATURE = [
  'with jagged asymmetric horns', 'with a tattered, battle-worn hide', 'covered in glowing bioluminescent markings',
  'bearing heavy ornamental armor plates', 'trailing wisps of elemental energy', 'scarred from countless battles',
  'adorned with tribal fetishes and bone charms', 'with elongated raking claws', 'wreathed in a faint spectral aura',
  'with a distinctive crest and mane', 'draped in torn banners and chains', 'with cracked, weathered skin',
  'sprouting crystalline growths', 'with a segmented, plated back', 'gaunt and skeletal in build',
  'broad, muscular and hunched',
];

// ---------------------------------------------------------------------------
// Human decks
// ---------------------------------------------------------------------------
//
// Not every deck is a bestiary. Ironhold is a HUMAN garrison — a levy, its masons and its
// captain — but the monster type it happens to carry decides its art, so by default its Terra
// bodies (Stonecutter, Quarryhand, Cairn Mason…) came out as rock elementals and its Warriors
// as tusked brutes. The monster type is a COMBAT type, not an ancestry.
//
// So a deck may declare that its people are people. That has to override four axes at once, not
// just the type descriptor: FEATURE, UNIT_POSE and SIZE_PHRASE are all written for monsters, and
// leaving any of them in place puts horns, prowling and "colossal boss-tier monster" back on a
// human soldier. Spells and traps are unaffected — they draw no body.
const HUMAN_DECKS = new Set(['ironhold']);
const isHumanDeck = (deckId: string) => HUMAN_DECKS.has(deckId);

// What a human of each combat type IS in Ironhold. Terra is the load-bearing one: an earth-typed
// human is a mason or a quarryman in stone-grey kit, never a creature of living stone.
const HUMAN_TYPE_DESC: Partial<Record<TypeName, string[]>> = {
  Warrior: [
    'a human soldier in dented iron plate', 'a human levy infantryman in a padded gambeson and kettle helm',
    'a scarred human veteran in a mail hauberk', 'a human shield-bearer behind a tall tower shield',
    'a human sergeant in battered brigandine', 'a young human recruit in ill-fitting borrowed armor',
  ],
  Terra: [
    'a human stonemason in leather and iron, mallet and chisel at their belt',
    'a human quarryman in a dust-caked apron and iron-shod boots',
    'a broad human labourer-soldier in stone-grey plate',
    'a human cairn-builder in a hooded work cloak, hands white with rock dust',
    'a human warden in armor faced with slabs of quarried stone',
    'a weathered human pit-foreman in banded iron',
  ],
};
// Fallback for a human deck that prints a type with no entry above: keep it human, stay generic.
const HUMAN_GENERIC = [
  'a human fighter in practical campaign armor', 'a human soldier of the garrison in worn kit',
  'a hard-bitten human in mail and leather',
];

// The monster FEATURE list is horns, claws and bioluminescence. This is its human twin.
const HUMAN_FEATURE = [
  'with a face scarred from old campaigns', 'in dented, field-repaired armor',
  'with a heavy fur-lined cloak over one shoulder', 'wearing a helm with the crest sheared off',
  'with grey-streaked hair tied back', 'with rope-burned, calloused hands',
  'with a leather eyepatch and a broken nose', 'draped in a torn garrison banner',
  'with a mud-caked cloak and worn boots', 'with a close-cropped beard and tired eyes',
  'in mismatched armor scavenged from the dead', 'with a clan tattoo across one cheek',
];

// Human poses: soldiering and stonework, not prowling and howling.
//
// ⚠ Split BY TYPE, unlike the monster lists. A single shared pool put "swinging a mallet down
// onto a chisel" on the Linebreaker and "charging with a pike lowered" on the Cairn Mason — the
// two exactly swapped — because the pose axis knew nothing about what the body was. Splitting it
// also decorrelates the two types' picks, which is what stopped a mason and a soldier landing on
// an identical pose/camera/lighting triple.
const HUMAN_POSE: Partial<Record<TypeName, string[]>> = {
  Warrior: [
    'braced behind a raised shield', 'mid-swing with a war hammer',
    'planted in a firm stance, spear levelled', 'advancing shoulder-to-shoulder in a shield line',
    'stepping forward over broken ground, weapon low', 'shouting an order over the din',
    'turning to face the viewer, sword drawn', 'crouched behind a low stone wall, watching',
    'holding the line as dust blows past', 'raising a horn to signal the line',
    'kneeling to steady a wounded comrade', 'charging with a pike lowered',
  ],
  Terra: [
    'driving a pick into cracked stone', 'swinging a mallet down onto a chisel',
    'hauling a cut stone block into place', 'setting a shield into the earth',
    'shouldering a slab of quarried rock', 'stacking a cairn of fitted stones',
    'braced behind a shield propped on rubble', 'wiping rock dust from their eyes mid-work',
    'planting a mason\'s maul like a weapon', 'heaving a barrow of broken stone',
    'kneeling to lay a foundation course', 'standing guard over a half-built wall',
  ],
};
const HUMAN_POSE_GENERIC = [
  'braced and ready', 'stepping forward over broken ground', 'turning to face the viewer',
];

// Power reads as equipment and bearing, since a human champion is not ten times the size of a
// levyman. Same four tiers as SIZE_PHRASE so sizeOf's tier maths is shared.
const HUMAN_SIZE_PHRASE = [
  'a young rank-and-file soldier, lightly equipped',
  'a seasoned soldier of ordinary build in solid kit',
  'a big, heavily-armored veteran, imposing but human in scale',
  'a towering champion in full plate, the largest figure on the field but still a human being',
];

const KEYWORD_FLAVOR: Record<Keyword, string> = {
  Ranged: 'poised to strike from a distance',
  Guard: 'braced in a shielded, defensive stance',
  Frenzy: 'caught mid-lunge in a berserk fury',
  // ⚠ `Rooted` was renamed `Anchored` in the CC pass and this map was never updated, so the
  // flavor silently dropped out. Piercing and Wallwalk were likewise never added — Ironhold's
  // Linebreaker is the first registered card to want one. Keep this exhaustive: `Record<Keyword,…>`
  // only catches a miss when tsc actually sees this file, and scripts/ is outside tsconfig.
  Anchored: 'planted immovably, refusing to give ground',
  Piercing: 'weapon angled to punch clean through armor',
  Wallwalk: 'moving surefooted along a sheer vertical wall',
};

// Physical size tracks power. Level is the primary driver (low level = small,
// top level = boss); ATK nudges the extremes. Fusion units are level 0 in data
// but are boss units, so they pin to the top tier. Tokens read as small.
const SIZE_PHRASE = [
  'a small, low-tier creature, compact and modest in size',
  'a mid-sized creature of solid, capable build',
  'a large and powerful creature, heavy and imposing',
  'a colossal boss-tier monster, towering and monstrous in scale, dominating the whole frame',
];
function sizeOf(e: Entry): string {
  const scale = isHumanDeck(e.deckId) ? HUMAN_SIZE_PHRASE : SIZE_PHRASE;
  if (e.kind === 'token') return scale[0]!;
  if (e.fusion) return scale[3]!;                     // lvl 0 in data, but a boss
  const lv = e.level ?? 3;
  let tier = lv <= 2 ? 0 : lv <= 4 ? 1 : lv <= 6 ? 2 : 3;
  const atk = e.atk ?? 0;
  if (atk >= 60 && tier < 3) tier++;                  // outlier stats push size up
  if (atk <= 10 && tier > 0) tier--;                  // …or down (eggs, chumps)
  return scale[tier]!;
}

// A visible cue drawn from a unit's most notable effect, so abilities read on
// the art. First match wins; non-visual effects (draw/SP) are skipped.
function abilityFlavor(rules: readonly { effect: { e: string } }[]): string {
  for (const r of rules) {
    switch (r.effect.e) {
      case 'AuraAtk': case 'AuraAtkPerCount': return 'radiating an empowering aura over nearby allies';
      case 'Damage': return 'crackling with destructive energy';
      case 'SummonToken': return 'attended by lesser spawn';
      case 'RaiseFromGraveyard': return 'wreathed in necromantic power';
      case 'PaintTerrain': return 'reshaping the terrain around it';
      case 'Push': case 'Pull': case 'ApplyStatus': return 'exerting a disruptive telekinetic force';
      case 'Transform': return 'mid-ascension, its form surging with new power';
    }
  }
  return '';
}

// Variety knobs. Each card draws one option per axis, chosen deterministically
// from its id (see pickFor) so every card differs but regenerations reproduce.
// The deck theme stays dominant; these vary pose / angle / action / accent within it.
const CAMERA = [
  'dramatic low-angle shot looking up', 'sweeping high-angle shot looking down',
  'dynamic three-quarter view', 'stark profile side view', 'head-on frontal composition',
  'over-the-shoulder view from behind', 'off-center wide establishing shot', 'tight dramatic close-up',
  'worm\'s-eye view from ground level', 'dutch-angle tilted composition',
  'distant silhouette against the horizon', 'dramatically foreshortened perspective',
];
const LIGHTING = [
  'rim-lit against a dusk sky', 'harsh directional key light', 'moonlit and shadowed',
  'underlit by a nearby fire glow', 'stormy overcast diffusion', 'shafts of volumetric god rays',
  'silhouetted with a bright backlight', 'cold dawn light', 'bathed in eerie bioluminescence',
  'flickering torchlit shadows', 'stark high-contrast chiaroscuro', 'warm golden-hour glow',
];
// A single complementary POP color layered over the deck palette, per card.
const ACCENT = [
  'a striking accent of electric cyan', 'a bold crimson accent glow', 'a vivid violet highlight',
  'a molten-gold rim light', 'an eerie emerald accent', 'a hot magenta highlight',
  'an icy pale-blue accent', 'a searing orange accent', 'a toxic chartreuse accent',
  'a deep sanguine-red glow', 'a spectral teal shimmer', 'a bruised-purple highlight',
];
const UNIT_POSE = [
  'roaring mid-charge', 'crouched low, ready to pounce', 'rearing up to full height',
  'lunging forward with limbs extended', 'standing sentinel-still and watchful', 'coiled and prowling',
  'slamming down onto the ground', 'turning to face the viewer, snarling', 'leaping through the air',
  'braced defensively, mid-battle', 'stalking through the murk', 'unleashing a bellowing cry',
  'perched and surveying its territory', 'mid-transformation with energy surging',
  'dragging a fallen foe', 'howling toward the sky', 'clashing against an unseen enemy',
  'emerging from cover', 'reeling back to strike', 'planted wide in a power stance',
];
const LEADER_POSE = [
  'standing atop a rise surveying the field', 'raising a weapon aloft to rally the horde',
  'advancing mid-stride through the fray', 'enthroned in their domain', 'turning with a commanding glare',
  'arms outstretched, channeling raw power', 'cloak billowing in the wind, poised for battle',
  'kneeling to touch the earth as power radiates', 'silhouetted before a massed army',
  'pointing forward to command the charge',
];
const SPELL_DYN = [
  'a spiraling vortex of raw energy', 'a shockwave bursting violently outward',
  'cascading motes raining down from above', 'a jagged eruption tearing up from the ground',
  'crackling arcs lancing across the scene', 'a slow-building luminous bloom of power',
  'a swirling storm of elemental force', 'a lattice of glowing runes detonating',
  'a collapsing implosion of dark energy', 'a sweeping tide of surging magic',
  'a beam of searing light splitting the sky', 'a blossom of spectral petals unfurling',
];
const TRAP_DYN = [
  'a concealed rune flaring to life underfoot', 'jaws of a snare springing shut',
  'a glinting tripwire in the gloom', 'a summoning circle igniting', 'shadowed sigils bleeding light through cracks',
  'a pressure-plate glowing an instant before it triggers', 'a cage of thorns snapping upward',
  'a hidden glyph erupting in a flash', 'a web of taut wires catching the light',
];

// Deterministic pick: FNV-1a over `id::salt` so different axes decorrelate.
function pickFor<T>(id: string, salt: string, arr: T[]): T {
  let h = 0x811c9dc5;
  const s = `${id}::${salt}`;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return arr[(h >>> 0) % arr.length]!;
}

// ---------------------------------------------------------------------------
// Build the flat list of things to draw (deduped by id, home-deck theme wins)
// ---------------------------------------------------------------------------

type Kind = 'leader' | 'unit' | 'spell' | 'trap' | 'token';
interface Entry {
  id: string; name: string; kind: Kind; deckId: string;
  type?: TypeName; atk?: number; level?: number; keywords?: Keyword[];
  fusion?: boolean;         // fusion units are boss-tier regardless of level
  abilityFlavor?: string;   // visible cue derived from the card's effects
  /** Extra salt mixed into every variety pick; bumped so no two cards in a deck collide. */
  varietySalt?: string;
}

// Which deck's theme a token wears: the first deck (in registry order) whose
// cards or leader summon it via a SummonToken effect. Tokens carry no deck
// attribution of their own in the merged registry.
function tokenThemeByDeck(): Map<string, string> {
  const map = new Map<string, string>();
  const scan = (effects: { effect: { e: string; tokenId?: string } }[] | undefined, deckId: string) => {
    for (const line of effects ?? []) {
      if (line.effect.e === 'SummonToken' && line.effect.tokenId && !map.has(line.effect.tokenId)) {
        map.set(line.effect.tokenId, deckId);
      }
    }
  };
  for (const deck of DECKS) {
    scan(deck.leader.rules, deck.id);
    scan(deck.leader.ability.effects, deck.id);
    for (const def of Object.values(deck.cards) as CardDef[]) {
      if (def.kind === 'unit') scan(def.rules, deck.id);
      else scan(def.effects, deck.id);
    }
  }
  return map;
}

function collectEntries(): Entry[] {
  const seen = new Set<string>();
  const out: Entry[] = [];
  const push = (e: Entry) => { if (!seen.has(e.id)) { seen.add(e.id); out.push(e); } };

  for (const deck of DECKS) {
    const leader: LeaderDef = deck.leader;
    push({ id: leader.id, name: leader.name, kind: 'leader', deckId: deck.id, type: leader.type, atk: leader.atk, abilityFlavor: abilityFlavor(leader.rules) });
    for (const def of Object.values(deck.cards) as CardDef[]) {
      if (def.kind === 'unit') push({ id: def.id, name: def.name, kind: 'unit', deckId: deck.id, type: def.type, atk: def.atk, level: def.level, keywords: def.keywords, fusion: !!def.fusion, abilityFlavor: abilityFlavor(def.rules) });
      else if (def.kind === 'spell') push({ id: def.id, name: def.name, kind: 'spell', deckId: deck.id });
      else push({ id: def.id, name: def.name, kind: 'trap', deckId: deck.id });
    }
  }
  // Tokens inherit the theme of the deck that summons them (else neutral).
  const tokenDeck = tokenThemeByDeck();
  for (const tok of Object.values(DECK_TOKENS) as TokenDef[]) {
    push({ id: tok.id, name: tok.name, kind: 'token', deckId: tokenDeck.get(tok.id) ?? '', type: tok.type, atk: tok.atk, keywords: tok.keywords });
  }
  assignVariety(out);
  return out;
}

// ---------------------------------------------------------------------------
// Per-card visual variety (deterministic, unique within a deck)
// ---------------------------------------------------------------------------

interface Visuals { desc?: string; feature?: string; pose: string; camera: string; lighting: string; accent: string }

/** All visual choices for a card at a given salt (salt lets us re-roll on collision). */
function pickVisuals(e: Entry, salt: string): Visuals {
  const key = `${e.id}${salt}`;
  const camera = pickFor(key, 'camera', CAMERA);
  const lighting = pickFor(key, 'lighting', LIGHTING);
  const accent = pickFor(key, 'accent', ACCENT);
  if (e.kind === 'spell') return { pose: pickFor(key, 'pose', SPELL_DYN), camera, lighting, accent };
  if (e.kind === 'trap') return { pose: pickFor(key, 'pose', TRAP_DYN), camera, lighting, accent };
  const human = isHumanDeck(e.deckId);
  return {
    desc: pickFor(key, 'typedesc', human ? (HUMAN_TYPE_DESC[e.type!] ?? HUMAN_GENERIC) : TYPE_DESC[e.type!]),
    feature: pickFor(key, 'feature', human ? HUMAN_FEATURE : FEATURE),
    // Leader poses are already human-shaped (rallying, commanding), so only unit poses swap.
    pose: pickFor(key, 'pose', e.kind === 'leader' ? LEADER_POSE
      : human ? (HUMAN_POSE[e.type!] ?? HUMAN_POSE_GENERIC) : UNIT_POSE),
    camera, lighting, accent,
  };
}

/** The visual identity that must be distinct within a deck. */
function signatureOf(v: Visuals, kind: Kind): string {
  return kind === 'spell' || kind === 'trap'
    ? `${v.pose}|${v.camera}`              // spells/traps: distinct effect + angle
    : `${v.desc}|${v.pose}|${v.feature}`;  // creatures: distinct build + pose + feature
}

/** Guarantee no two cards in the same deck share a visual signature: re-roll the
 *  salt (which shifts every axis) until each card's signature is unique. */
function assignVariety(entries: Entry[]): void {
  const byDeck = new Map<string, Entry[]>();
  for (const e of entries) {
    const g = byDeck.get(e.deckId) ?? [];
    g.push(e);
    byDeck.set(e.deckId, g);
  }
  for (const group of byDeck.values()) {
    const used = new Set<string>();
    for (const e of [...group].sort((a, b) => a.id.localeCompare(b.id))) {
      // A card with a hand-written prompt draws none of these axes, so it must not RESERVE a
      // signature either — doing so would push its deck-mates into needless re-rolls.
      if (PROMPT_OVERRIDES[e.id] !== undefined) continue;
      let salt = '';
      for (let k = 0; k < 500; k++) {
        salt = k === 0 ? '' : `~${k}`;
        const sig = signatureOf(pickVisuals(e, salt), e.kind);
        if (!used.has(sig)) { used.add(sig); break; }
      }
      e.varietySalt = salt;
    }
  }
}

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

/**
 * Where variant `n` of a card's art lives. Variant 1 is the bare `<id>.jpg` so every
 * existing file and every consumer keeps working; alternates are suffixed.
 */
export function artFileName(id: string, n: number): string {
  return n <= 1 ? `${id}.jpg` : `${id}-${n}.jpg`;
}

/**
 * The variety salt for variant `n`. Alternates re-roll every visual axis rather than
 * merely changing the diffusion seed — two images of the same pose from different
 * seeds are the same picture twice, which is no choice at all.
 *
 * ⚠ Variant 1 must return the salt UNCHANGED, or every existing card's prompt (and so
 * its art) silently changes the next time it is regenerated.
 */
function variantSalt(e: Entry, n: number): string {
  const base = e.varietySalt ?? '';
  // Same reason as `overrideFor`: in a multi-model run the variant axis is the ENGINE, so every
  // variant must draw the identical visual recipe or the models are being compared on different
  // poses. Applies to recipe-built cards exactly as it does to hand-written ones.
  if (MULTI_MODEL) return base;
  return n <= 1 ? base : `${base}@${n}`;
}

// ---------------------------------------------------------------------------
// Per-card prompt overrides
// ---------------------------------------------------------------------------

/**
 * Hand-written prompts for specific cards, used VERBATIM in place of the generated recipe.
 *
 * The recipe below is built for COHESION across 160-odd cards — it is what stops the set looking
 * like a hundred unrelated pictures. That is exactly the wrong tool for the handful of cards you
 * want to art-direct individually (leaders, a signature body), where a bespoke composition beats a
 * consistent one. Those go here.
 *
 * ⚠ VERBATIM means verbatim: no master style, no deck theme, no negatives are appended. An
 * override owns its own palette, composition, render notes AND negative list, because half a
 * recipe is worse than none. Copy the shape of the entries below.
 *
 * A string applies to every variant, so alternates differ only by diffusion seed — which is the
 * same picture twice. Prefer an ARRAY, one prompt per variant, to get genuinely different images.
 * Asking for more variants than there are prompts reuses the last one with a fresh seed.
 *
 * Composition rules the frame imposes, and which every override must respect:
 *   · 3:4 portrait — the card frame is `aspect-ratio: 3 / 4` with `object-fit: cover`.
 *   · Keep the lower quarter quiet — the name plate is composited over it.
 *   · Leave a margin — the foil hairline and corner brackets sit inset from the edge.
 */
/**
 * Compose a leader prompt: bespoke art direction on top of the constraints the CARD FRAME imposes.
 *
 * The frame half is identical for all nine and getting it wrong is invisible until the art is in
 * the game — a busy lower quarter disappears under the name plate, and a subject run to the edge
 * collides with the foil hairline. Centralising exactly that part keeps it impossible to forget
 * while leaving every creative decision in the per-leader call. The result is still a plain string,
 * so `PROMPT_OVERRIDES` entries may equally be hand-written literals.
 */
function leaderPrompt(o: {
  /** Who and what they are DOING — the whole point of the card. */
  subject: string;
  /** Where, in one or two sentences. Should differ from every other leader's. */
  setting: string;
  /** Copied from this deck's DECK_THEMES entry: overrides bypass the theme machinery entirely. */
  palette: string;
  mood: string;
  /** Camera. Deliberately distinct per leader so nine hero shots do not read as one shot. */
  camera: string;
  /** Where the eye should land — kept out of the lower quarter. */
  focus: string;
  /**
   * ⚠ Set for Ironhold and The Red Mark. Both are HUMAN companies, and that rule lives in
   * `HUMAN_DECKS`/`masterStyle`, which an override bypasses — without this clause their leaders
   * render as monsters, which is a regression already fixed once for Ironhold's units.
   */
  human?: boolean;
}): string {
  const humanClause = o.human
    ? ' The subject is an ordinary human being with a human face and human proportions — no horns, '
      + 'no claws, no fangs, no tusks, no glowing eyes, no scales; not an orc, not a beast-man, '
      + 'not a golem, not an elemental.'
    : '';
  const humanNegative = o.human ? ', no horns, no claws, no monster features, not an orc' : '';
  return [
    `${o.subject}${humanClause}`,
    o.setting,
    `Palette: ${o.palette}. Mood: ${o.mood}.`,
    `Composition: portrait, 3:4 aspect ratio. ${o.camera} ${o.focus} Keep the lower quarter of the `
      + 'image quiet — ground, shadow and atmosphere only, no faces and no critical detail there. '
      + 'Keep the subject clear of the outer edges, with a margin of background all the way around.',
    'Render: hyper-detailed cinematic digital painting, dramatic lighting, high contrast, rich '
      + 'saturated colour, painterly dark-fantasy concept art, premium collectible trading-card '
      + 'illustration quality.',
    `Negative: no text, no words, no lettering, no title, no nameplate, no card frame, no border, `
      + `no corner brackets, no UI, no watermark, no signature, no logo${humanNegative}.`,
  ].join('\n');
}

const PROMPT_OVERRIDES: Record<string, string | string[]> = {
  // --- THE NINE LEADERS -----------------------------------------------------------------------
  // Each is art-directed off its own RULES, so the picture argues for the card: Briar paints
  // Forest as she moves, Vessik's aura grows with his graveyard, Kaelen has Divebomb, and so on.
  // Every one gets a different action verb, camera and setting — nine hero portraits that share a
  // recipe read as one shot taken nine times, which is the failure the recipe already has.
  //
  // ⚠ Pronouns follow the design vault, which genders only Briar and Neris (she). Brood Matron is
  // a feminine title. The other six are left unpronouned rather than invented here.

  briar: leaderPrompt({
    subject:
      '"Briar, the Wildshepherd" — a towering druidic guardian of bark, moss and antler, kneeling '
      + 'to press one broad palm flat against bare earth. Forest erupts outward from the point of '
      + 'contact in a visible wave: roots heaving up, saplings shooting to full height, bracken '
      + 'unrolling across the ground in a widening ring around her. A press of great horned beasts '
      + 'and wolves crowds at her shoulder, following where the green goes.',
    setting:
      'Set in a lush overgrown primeval forest of ancient roots and canopy light, the raw new ring '
      + 'of growth bright against older darker woodland behind.',
    palette: 'verdant greens, mossy gold and dappled sunlight',
    mood: 'wild, fecund, druidic',
    camera: 'Low three-quarter view close to the ground, so the erupting earth reads as subject too.',
    focus: 'Her face and the planted hand sit in the upper two thirds and are the focal point.',
  }),

  vessik: leaderPrompt({
    subject:
      '"Ossuary Vessik, the Grave-Chandler" — a gaunt robed undead chandler calmly lighting a rack '
      + 'of candles moulded from femurs and grave-tallow, working along the row with a long taper. '
      + 'Every candle lit throws up a translucent green silhouette of a risen soldier standing to '
      + 'attention behind, so the hall fills with a growing ghostly muster. Ranks of unlit '
      + 'bone-candles wait in the dark beyond, promising more.',
    setting:
      'Set in a fog-wreathed ossuary opening onto fields of bone, mist pooling between the ranks.',
    palette: 'sickly green, bone white and necrotic violet',
    mood: 'grim, decaying, funereal',
    camera: 'Straight-on, near-symmetrical, lit from below by the candle rack.',
    focus: 'The chandler\'s face and the lit taper sit in the upper half and are the focal point.',
  }),

  kaelen: leaderPrompt({
    subject:
      '"Kaelen, the Ashwing" — a great ash-feathered avian warrior folded into a full stoop, wings '
      + 'swept hard back into a blade, plummeting head-first straight down at the viewer with '
      + 'talons leading. Soot and embers pour off the feathers. Torn ash whips past in vertical '
      + 'streaks with the speed of the fall.',
    setting:
      'Set in storm-torn skies above erupting volcanic peaks, lava-lit cloud far below and '
      + 'lightning buried in the ash column behind.',
    palette: 'ember orange, ash grey and molten red',
    mood: 'aggressive, blazing, kinetic',
    camera: 'Head-on from directly beneath the dive, extreme foreshortening — the viewer is the target.',
    focus: 'The eyes and the leading talons sit in the upper two thirds and are the focal point.',
  }),

  neris: leaderPrompt({
    subject:
      '"Neris, the Undertow" — an armoured deep-sea sorceress standing motionless at the eye of '
      + 'the current while the whole ocean leans toward her. Serpentine tentacled lower body '
      + 'anchored on the barnacled prow of a wrecked hull, dark plate armour hung with coral, '
      + 'pearls and bone charms, a horned helm, a long clawed staff held low and level. Her other '
      + 'hand is open at her side, fingers curled inward. Kelp, ship timbers and sheets of foam '
      + 'slide across the frame toward that hand, suspended mid-drag. Her cloak and hair stream '
      + 'INWARD against the pull, not outward.',
    setting:
      'Set in surging seas and crushing tidal depths, a towering wave curling overhead without '
      + 'breaking, held. Silhouettes of a drowned host stand waist-deep behind her, still, waiting.',
    palette: 'deep teal, foam white and abyssal blue with a sickly bioluminescent green accent',
    mood: 'cold, imperious, controlling — absolute stillness at the centre of enormous force',
    camera: 'Low angle looking up, so she towers over the viewer against the curling wave.',
    focus: 'Her helm and the open hand sit in the upper third and are the focal point.',
  }),

  broodMatron: leaderPrompt({
    subject:
      '"Brood Matron" — a colossal insect queen half-fused into the wall of her own hive, abdomen '
      + 'grown into the chamber chitin, birthing a fresh swarmling that hauls itself free of a wax '
      + 'cell and crawls down toward the viewer, still glistening wet. Older swarmlings cling '
      + 'around her in the dark. Her forelimbs fold protectively over the brood.',
    setting:
      'Set deep in chitinous hive tunnels and seething nests, wax cells receding into amber gloom.',
    palette: 'amber carapace, venom green and waxen ochre',
    mood: 'teeming, alien, relentless',
    camera: 'Tight claustrophobic close-up inside the tunnel, the walls pressing in at the edges.',
    focus: 'Her head and the newly hatched swarmling sit in the upper two thirds and are the focal point.',
  }),

  vharos: leaderPrompt({
    subject:
      '"Vharos, the Spirekeeper" — an ancient plated dragon braced on a peak it is in the act of '
      + 'MAKING: obsidian rises in fractured columns beneath its claws, thrusting the mountain up '
      + 'underneath it as it stands, magma bleeding down the fresh cracks. Wings half-spread for '
      + 'balance against the rising stone, head turned down toward the viewer.',
    setting:
      'Set among colossal obsidian mountain spires wreathed in magma, older spires behind lost in '
      + 'volcanic haze.',
    palette: 'obsidian black, magma orange and dragon-scale crimson',
    mood: 'colossal, ancient, apex',
    camera: 'Distant low angle looking far up, so both the spire and the dragon read at scale.',
    focus: 'The head and the rising obsidian columns sit in the upper two thirds and are the focal point.',
  }),

  oskar: leaderPrompt({
    subject:
      '"Oskar, the Pale Shepherd" — a pale robed undead shepherd on a sand ridge with a crook '
      + 'raised, calling the buried up out of the desert. Skeletal soldiers claw their way out of '
      + 'the dunes all around, sand sheeting off shoulders and helms as they rise in a widening '
      + 'arc. Robes and grave-wrappings snap in the dry wind.',
    setting:
      'Set in scorched desert wastes over buried ruins, broken columns and half-swallowed masonry '
      + 'breaking the dune line behind.',
    palette: 'sun-bleached ochre, rust and forged bronze',
    mood: 'harsh, convergent, weathered',
    camera: 'High angle looking down across the dune, so the widening arc of risers reads as a pattern.',
    focus: 'The raised crook and hooded face sit in the upper two thirds and are the focal point.',
  }),

  // HUMAN — The Red Mark is a company of human archers, and this deck has no DECK_THEMES entry, so
  // the palette below is the only place its look is written down.
  sable: leaderPrompt({
    human: true,
    subject:
      '"Sable, the Oathbroken" — a human archer-captain in dark worn leather and a scarred '
      + 'half-cape, at full draw on a ridge, bowstring back to the cheek, holding the shot. A '
      + 'burning red sigil brands a distant target far across the field, glowing exactly where the '
      + 'arrow will land. A disciplined rank of archers waits on the slope below, arrows nocked, '
      + 'holding for the loose.',
    setting:
      'Set on a grassland ridge above walled fields, tall grass flattening in the wind, planted '
      + 'stakes and pavises marking the archer line along the slope.',
    palette: 'oxblood red, worn leather brown, dry grassland gold and cold steel',
    mood: 'disciplined, patient, lethal at distance',
    camera: 'Over-the-shoulder from behind and slightly above, sighting past the drawn bow.',
    focus: 'The drawn bow, the sighting eye and the distant red mark sit in the upper two thirds and are the focal point.',
  }),

  // HUMAN — Ironhold is a human garrison; without the clause its captain renders as a monster.
  rhodan: leaderPrompt({
    human: true,
    subject:
      '"Captain Rhodan" — a human captain in dented iron plate locked shoulder to shoulder in a '
      + 'shield line, one arm thrust forward past the shield rim to give the order, mouth open '
      + 'mid-shout. The soldiers to either side brace on the same beat, shields grinding together, '
      + 'spears levelling as one down the line.',
    setting:
      'Set before a grey mountain fortress above walled grassland holdings, banners snapping over '
      + 'the gatehouse behind the line.',
    palette: 'iron grey, quarried stone, dull steel blue and faded banner red',
    mood: 'disciplined, dogged, dug-in',
    camera: 'Eye-level within the line itself, slightly low.',
    focus: 'The shouting face and the thrust-out arm sit in the upper two thirds and are the focal point.',
  }),
};

/**
 * The bespoke prompt for variant `n` of a card, or undefined if it uses the generated recipe.
 *
 * ⚠ In a MULTI-MODEL run the variant axis means "which engine", not "which pose", so every variant
 * takes prompt 1. Without this the array form would hand each model a different prompt and the
 * comparison would be confounded — you could not tell a better engine from a better prompt.
 */
function overrideFor(id: string, n: number): string | undefined {
  const entry = PROMPT_OVERRIDES[id];
  if (entry === undefined) return undefined;
  if (typeof entry === 'string') return entry;
  if (entry.length === 0) return undefined;
  if (MULTI_MODEL) return entry[0];
  // Past the end, reuse the last prompt — a fresh seed on a written prompt is still a new image,
  // just a less different one than a purpose-written alternate would be.
  return entry[Math.min(n - 1, entry.length - 1)];
}

function buildPrompt(e: Entry, n = 1): string {
  // An override replaces the recipe wholesale — see PROMPT_OVERRIDES.
  const bespoke = overrideFor(e.id, n);
  if (bespoke) return bespoke.trim();

  const theme = DECK_THEMES[e.deckId] ?? NEUTRAL_THEME;
  const setting = `Set in ${theme.biome}. Dominant palette: ${theme.palette}. Mood: ${theme.mood}.`;
  const kw = (e.keywords ?? []).map((k) => KEYWORD_FLAVOR[k]).filter(Boolean).join(', ');
  const v = pickVisuals(e, variantSalt(e, n));
  const human = isHumanDeck(e.deckId);
  const body = human ? 'figure' : 'creature';

  let subject: string;
  switch (e.kind) {
    case 'leader':
      subject = `Epic hero portrait of "${e.name}", a legendary commander — ${v.desc} of great renown, ${v.feature}, ${v.pose}${e.abilityFlavor ? `, ${e.abilityFlavor}` : ''}, seen in ${v.camera}, ornate detail, commanding presence.`;
      break;
    case 'unit':
      subject = `A single ${body}: "${e.name}", ${v.desc}, ${v.feature}, ${sizeOf(e)}, ${v.pose}${e.abilityFlavor ? `, ${e.abilityFlavor}` : ''}, seen in ${v.camera}${kw ? `, ${kw}` : ''}. One ${human ? 'person' : 'creature'} only.`;
      break;
    case 'token':
      subject = `A minor lesser minion: "${e.name}", ${v.desc}, ${v.feature}, small and expendable, ${v.pose}, seen in ${v.camera}${kw ? `, ${kw}` : ''}. One ${body}, simple.`;
      break;
    case 'spell':
      subject = `A spell being cast: "${e.name}" — ${v.pose}, seen in ${v.camera}, no character as the focus, an event not a creature.`;
      break;
    case 'trap':
      subject = `A hidden magical trap: "${e.name}" — ${v.pose}, seen in ${v.camera}, tense and foreboding, no character as the focus.`;
      break;
  }
  // Spells and traps draw no body, so the human clause would only add noise to them.
  const humanSubject = human && e.kind !== 'spell' && e.kind !== 'trap';
  return `${subject} ${setting} Lighting: ${v.lighting}, with ${v.accent}. ${masterStyle(humanSubject)}`;
}

// ---------------------------------------------------------------------------
// Content-checker fallback
// ---------------------------------------------------------------------------

/**
 * Tamer wording for the gore/body vocabulary that pushes a prompt over the provider's content
 * checker. Applied ONLY after a card has actually been blocked, so the ~95% of cards that pass
 * keep their original, darker prompt — this is a rescue path, not a global tone change.
 *
 * The set is empirical: these are the phrases carried by the cards that lost 8 straight rolls
 * (Rotmaw Swarm, The Pale Shepherd, Dragnet Harpooner, Marked-Warden Tarr, Vessa).
 */
const SANITIZE: [RegExp, string][] = [
  [/dragging a fallen foe/g, 'standing over a fallen banner'],
  [/a rotting shambling corpse/g, 'a shambling, decayed revenant in grave-wrappings'],
  [/a risen undead horror/g, 'a risen armored revenant'],
  [/a bone-and-sinew abomination/g, 'a bone-plated armored abomination'],
  [/a gaunt clawed nightmare/g, 'a lean, armored nightmare-thing'],
  [/a ragged carrion-bird/g, 'a ragged scavenger bird'],
  [/a tentacled deep-sea horror/g, 'a deep-sea leviathan with long coiling arms'],
  [/gaunt and skeletal in build/g, 'lean and angular in build'],
  [/with cracked, weathered skin/g, 'with cracked, weathered armor'],
  [/with elongated raking claws/g, 'with long curved talons'],
  [/kneeling to steady a wounded comrade/g, 'steadying a comrade by the shoulder'],
  [/rotting/g, 'decayed'],
  [/\bcorpse\b/g, 'revenant'],
  [/\bwounded\b/g, 'weary'],
];

const sanitizePrompt = (p: string) => SANITIZE.reduce((s, [re, to]) => s.replace(re, to), p);
const isPolicyBlock = (msg: string) => msg.includes('content_policy_violation');

// FNV-1a -> stable 31-bit seed from the card id (reproducible regenerations).
// Variant n > 1 hashes a suffixed key, so alternates get an independent seed while
// variant 1 keeps the exact seed every existing image was generated with.
function seedFor(id: string, n = 1): number {
  const key = n <= 1 ? id : `${id}#${n}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0) % 2_000_000_000;
}

// ---------------------------------------------------------------------------
// Providers — return raw image bytes for a prompt
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchBytes(url: string): Promise<Uint8Array> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download ${r.status} ${url}`);
  return new Uint8Array(await r.arrayBuffer());
}

/** Thrown when a model returns the wrong shape. Retryable, but only at a DIFFERENT seed. */
const ASPECT_MISMATCH = 'aspect-mismatch';
const isAspectMismatch = (msg: string) => msg.includes(ASPECT_MISMATCH);

/**
 * Reject an image whose shape does not match the card frame.
 *
 * ⚠ `aspect_ratio` is a REQUEST, not a guarantee. Kontext Max was measured returning 1024×768
 * (landscape!) for a prompt at one seed and a correct 880×1184 for the same prompt at another —
 * so the parameter is honoured per-seed, not per-request. Nothing errors when this happens: the
 * image just arrives the wrong shape, and `object-fit: cover` on a 3:4 frame then crops the sides
 * off it in game. Catching it here is the only place it is cheap to notice.
 *
 * Models that report no dimensions are let through — an unchecked image beats no image.
 */
function assertCardAspect(image: { width?: number; height?: number }, model: ModelSpec): void {
  const { width, height } = image;
  if (!width || !height) return;
  const ratio = width / height;
  const want = 3 / 4;
  if (Math.abs(ratio - want) > 0.02) {
    throw new Error(`${ASPECT_MISMATCH}: ${model.label} returned ${width}×${height} (${ratio.toFixed(2)}), wanted 3:4`);
  }
}

async function genFal(prompt: string, seed: number, model: ModelSpec): Promise<Uint8Array> {
  const key = process.env.FAL_KEY;
  if (!key) throw new Error('FAL_KEY not set');
  const headers = { Authorization: `Key ${key}`, 'Content-Type': 'application/json' };
  const submit = await fetch(`https://queue.fal.run/${model.id}`, {
    method: 'POST', headers,
    // The model builds its OWN body — see ModelSpec. Do not add fields here.
    body: JSON.stringify(model.input(prompt, seed)),
  });
  if (!submit.ok) throw new Error(`fal submit ${submit.status}: ${await submit.text()}`);
  const { status_url, response_url } = await submit.json() as { status_url: string; response_url: string };

  for (let i = 0; i < 120; i++) {
    await sleep(2000);
    const s = await fetch(status_url, { headers });
    const st = await s.json() as { status: string };
    if (st.status === 'COMPLETED') break;
    if (st.status === 'FAILED' || st.status === 'ERROR') throw new Error(`fal job ${st.status}`);
    if (i === 119) throw new Error('fal job timed out');
  }
  // ⚠ Report the BODY on failure. This used to throw a bare "fal returned no image", which hid
  // the actual cause (content-filter rejections, quota and rate-limit payloads all land here as
  // a COMPLETED job with no images key) and made a 9-of-12 failure undiagnosable.
  const raw = await (await fetch(response_url, { headers })).text();
  let res: { images?: { url: string; width?: number; height?: number }[] };
  try { res = JSON.parse(raw); } catch { throw new Error(`fal response not JSON: ${raw.slice(0, 300)}`); }
  const image = res.images?.[0];
  if (!image?.url) throw new Error(`fal returned no image: ${raw.slice(0, 300)}`);
  assertCardAspect(image, model);
  return fetchBytes(image.url);
}

async function genReplicate(prompt: string, seed: number, model: ModelSpec): Promise<Uint8Array> {
  const key = process.env.REPLICATE_API_TOKEN;
  if (!key) throw new Error('REPLICATE_API_TOKEN not set');
  const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const submit = await fetch(`https://api.replicate.com/v1/models/${model.id}/predictions`, {
    method: 'POST', headers,
    body: JSON.stringify({ input: { prompt, seed, aspect_ratio: '3:4', output_format: 'jpg', num_outputs: 1 } }),
  });
  if (!submit.ok) throw new Error(`replicate submit ${submit.status}: ${await submit.text()}`);
  let pred = await submit.json() as { status: string; output?: string[]; urls: { get: string } };
  for (let i = 0; i < 120 && (pred.status === 'starting' || pred.status === 'processing'); i++) {
    await sleep(2000);
    pred = await (await fetch(pred.urls.get, { headers })).json();
  }
  if (pred.status !== 'succeeded' || !pred.output?.[0]) throw new Error(`replicate job ${pred.status}`);
  return fetchBytes(pred.output[0]);
}

const generate = PROVIDER === 'replicate' ? genReplicate : genFal;

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

const exists = (p: string) => access(p).then(() => true, () => false);

type ManifestRow = { id: string; variant?: number; kind: Kind; deckId: string; file: string; seed: number; prompt: string; provider: string; model: string; modelLabel?: string; at: string; sanitized?: boolean; override?: boolean };

/** One image to generate: a card, and which of its alternates this is. */
interface Job { entry: Entry; n: number }

async function loadManifest(): Promise<Record<string, ManifestRow>> {
  try { return JSON.parse(await readFile(MANIFEST, 'utf8')); } catch { return {}; }
}

/**
 * Write `variants.json` — `{ cardId: [1, 2, 3] }` for every card holding MORE than one
 * illustration. The UI fetches this to know which cards offer a choice; without it the
 * only way to find alternates would be to probe for 404s.
 *
 * ⚠ The value is the LIST of variants that exist, not a count. Generation fails per
 * image (the content checker rejects individual prompts), so a card can end up with
 * variants 1 and 3 but not 2 — and a count would then have the picker offer a variant
 * whose file is missing.
 *
 * Built by SCANNING the directory rather than from this run's results, so hand-added or
 * hand-deleted files are reflected too, and a `--only` run cannot truncate the index.
 */
async function writeVariantIndex(): Promise<void> {
  const found: Record<string, number[]> = {};
  for (const name of await readdir(OUT_DIR)) {
    const m = /^(.+?)(?:-(\d+))?\.jpg$/.exec(name);
    if (!m) continue;
    const id = m[1]!;
    (found[id] ??= []).push(m[2] ? parseInt(m[2], 10) : 1);
  }
  // Each variant carries the model that drew it, read back out of the manifest, so the in-game
  // picker can caption a thumbnail. Without a label a three-way model bake-off is three
  // indistinguishable thumbnails and you cannot act on the result.
  const manifest = await loadManifest();
  // Rows written before models were tracked carry only the raw endpoint id, so map it back to the
  // registry's friendly label where we know it — otherwise the picker captions a thumbnail
  // "fal-ai/flux-2-pro", which is not a label anyone reads.
  const byEndpoint = new Map(Object.values(MODELS).map((m) => [m.id, m.label]));
  const labelFor = (id: string, n: number): string | undefined => {
    const row = manifest[artFileName(id, n)];
    if (!row) return undefined;
    return row.modelLabel ?? (row.model ? byEndpoint.get(row.model) ?? row.model : undefined);
  };
  const multi = Object.fromEntries(
    Object.entries(found)
      .filter(([, ns]) => ns.length > 1)
      // `as const` keeps this a TUPLE. A bare array literal widens the pair to a union, which
      // loses the key/value split and makes the sort below untypeable.
      .map(([id, ns]) => [
        id,
        ns.sort((a, b) => a - b).map((n) => {
          const model = labelFor(id, n);
          return model ? { n, model } : { n };
        }),
      ] as const)
      .sort(([a], [b]) => a.localeCompare(b)),
  );
  await writeFile(VARIANT_INDEX, JSON.stringify(multi, null, 2));
  console.log(`Variant index: ${Object.keys(multi).length} card(s) with alternates -> public/card-art/variants.json`);
}

async function main() {
  // Fail fast (before scanning/queueing) if the provider's key is missing.
  if (!DRY_RUN && !process.env[KEY_ENV]) {
    const where = PROVIDER === 'replicate'
      ? 'https://replicate.com/account/api-tokens'
      : 'https://fal.ai/dashboard/keys';
    console.error(
      `Missing ${KEY_ENV} for provider "${PROVIDER}".\n` +
      `Add it to .env (echo '${KEY_ENV}=...' >> .env) or export it, then re-run.\n` +
      `Get a key at ${where}. (Use --dry-run to preview prompts without a key.)`,
    );
    process.exit(1);
  }

  await mkdir(OUT_DIR, { recursive: true });
  let entries = collectEntries();
  if (ONLY.size) entries = entries.filter((e) => ONLY.has(e.id));

  const manifest = await loadManifest();

  // Decide what to actually generate: one job per (card, variant).
  const todo: Job[] = [];
  for (const e of entries) {
    for (let n = 1; n <= VARIANTS; n++) {
      const file = join(OUT_DIR, artFileName(e.id, n));
      if (!FORCE && await exists(file)) continue;
      todo.push({ entry: e, n });
    }
  }

  const slots = entries.length * VARIANTS;
  console.log(`Registry: ${entries.length} cards × ${VARIANTS} variant(s). To generate: ${todo.length} (skipping ${slots - todo.length} existing).`);
  const modelLine = MULTI_MODEL
    ? MODELS_IN_RUN.map((m, i) => `variant ${i + 1}=${m.label}`).join(', ')
    : `${SINGLE_MODEL.label} (${SINGLE_MODEL.id})`;
  console.log(`Provider: ${PROVIDER}  Model: ${modelLine}  Concurrency: ${CONCURRENCY}${DRY_RUN ? '  [DRY RUN]' : ''}`);
  // Say it out loud rather than let someone discover it when a regenerate comes back different.
  for (const m of MODELS_IN_RUN) {
    if (!m.seeded) console.log(`⚠ ${m.label} accepts no seed — its images are NOT reproducible on regenerate.`);
  }
  console.log();

  if (DRY_RUN) {
    for (const { entry: e, n } of todo) {
      const tag = overrideFor(e.id, n) ? ' [hand-written override]' : '';
      const seed = seedFor(e.id, MULTI_MODEL ? 1 : n);
      console.log(`# ${artFileName(e.id, n)} (${e.kind}${e.deckId ? `, ${e.deckId}` : ''}) model=${modelForVariant(n).label} seed=${seed}${tag}`);
      console.log(buildPrompt(e, n) + '\n');
    }
    console.log(`Dry run: ${todo.length} prompts shown, nothing generated.`);
    await writeVariantIndex();
    return;
  }

  let done = 0, failed = 0;
  const queue = [...todo];
  async function worker() {
    while (queue.length) {
      const { entry: e, n } = queue.shift()!;
      const model = modelForVariant(n);
      // Multi-model runs pin the seed to variant 1's too, so the ONLY difference between
      // variants is the engine. (Seeds are not comparable across models, but a shared one keeps
      // the "identical input" claim honest and makes a re-run of one model reproducible.)
      const seed = seedFor(e.id, MULTI_MODEL ? 1 : n);
      const prompt = buildPrompt(e, n);
      const file = artFileName(e.id, n);
      try {
        // Retry with backoff, escalating to the sanitized prompt once the checker has actually
        // blocked this card. Without the retry a whole run is lost to provider flake; without the
        // escalation, borderline-gore cards never land at all.
        let bytes: Uint8Array | undefined;
        let used = prompt;
        let usedSeed = seed;
        let sanitized = false;
        for (let attempt = 1; ; attempt++) {
          try { bytes = await generate(used, usedSeed, model); break; }
          catch (err) {
            const msg = (err as Error).message;
            if (isPolicyBlock(msg) && !sanitized && sanitizePrompt(prompt) !== prompt) {
              used = sanitizePrompt(prompt);
              sanitized = true;
              console.warn(`  … ${e.id}: content-blocked, retrying with sanitized prompt`);
              continue;                                  // the reword is the fix; don't burn a roll
            }
            if (attempt >= RETRIES) throw err;
            if (isAspectMismatch(msg)) {
              // ⚠ MUST move the seed. The wrong shape is a property of this prompt AT THIS SEED, so
              // retrying unchanged reproduces it exactly and burns every remaining attempt.
              usedSeed = seed + attempt;
              console.warn(`  … ${e.id}: ${msg.slice(0, 70)}; retrying at seed ${usedSeed}`);
              continue;
            }
            console.warn(`  … ${e.id}: attempt ${attempt} failed (${msg.slice(0, 80)}), retrying`);
            await sleep(3000 * attempt);
          }
        }
        await writeFile(join(OUT_DIR, file), bytes!);
        // Keyed by FILE, not by card: a card with alternates has one row per image.
        // `usedSeed`, not `seed`: an aspect retry moves the seed, and recording the one we asked
        // for rather than the one that worked would make the row unreproducible.
        manifest[file] = { id: e.id, variant: n, kind: e.kind, deckId: e.deckId, file: `card-art/${file}`, seed: usedSeed, prompt: used, provider: PROVIDER, model: model.id, modelLabel: model.label, at: new Date().toISOString(), ...(sanitized ? { sanitized: true } : {}), ...(overrideFor(e.id, n) ? { override: true } : {}) };
        await writeFile(MANIFEST, JSON.stringify(manifest, null, 2));
        console.log(`  ✓ ${++done}/${todo.length}  ${file}  [${model.label}]`);
      } catch (err) {
        failed++;
        console.error(`  ✗ ${file}: ${(err as Error).message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
  await writeVariantIndex();
  console.log(`\nDone. ${done} generated, ${failed} failed. Manifest: public/card-art/manifest.json`);
}

main().catch((e) => { console.error(e); process.exit(1); });
