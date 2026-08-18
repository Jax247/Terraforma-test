# Terraforma POC

Throwaway hotseat proof-of-concept for the Terraforma design vault. Two goals:

1. **Play it** — two players, one screen, Wildgrowth (Briar) vs Gravemarch (Oskar) on the sim map.
2. **Prove the rules** — the nine vault simulations are encoded as Vitest suites; the engine is correct iff replaying them yields the states the notes describe.

## Run

```sh
npm install
npm run dev        # hotseat game at the printed localhost URL
npm test           # sim suites + stats/combat/purity/fuzz + AI self-play/strength gates + relay-server rooms
npm run typecheck
```

## Play online (two machines / tabs)

Lockstep action relay: a rules-agnostic Node WebSocket server (`server/`) manages rooms and
relays engine `Action`s; both clients run the deterministic engine locally (the host fixes both
shuffled deck orders at start, so replaying the same log yields identical states). Needs Node ≥ 24
(the server runs as TypeScript via type-stripping).

**Dev** (two terminals; Vite proxies `/ws` to the relay):

```sh
npm run server     # relay on :8787
npm run dev        # open the printed URL (LAN players can use the network URL)
```

**Production / internet** (single process serves the built app + `/ws` — deployable to any Node host):

```sh
npm run build && npm start   # http://localhost:8787, PORT env to override
```

**Invite flow**: topbar **Online** → *Create room* → *Copy invite link* (or read out the 5-char
code). The invitee opens the link (auto-joins) or enters the code, both pick a deck (custom decks
work — full card defs travel with them), the host picks the board, both hit *Ready*, host starts.
Online games hide hidden information per seat (opponent hand/deck/face-down identities); a
mid-game refresh rejoins and replays automatically. Both clients must run the same build — on
version skew the fingerprint check surfaces a desync banner instead of diverging silently.

## Decks

Nine registered decks in `src/engine/content/decks/`: Wildgrowth (Forest terrain-combo),
Gravemarch (Undead attrition), **Skyfire** (Avian mobility — see below), Tidecaller (Aqua
displacement), **Hivebrood** (Insect consumption — the swarm eats its own chaff to grow),
Dragonspire (Dragon go-tall ramp; deliberately probes stat ceilings: first level-7 unit,
first DC-5 card, an 85-ATK fusion), Duneforged (a mixed deck borrowing from three
registries under Oskar — Undead/Insect/Inferno all favor Desert, Scorched Earth paints it),
**The Red Mark** (board structure) and **Ironhold** (the starter deck and A/B control; stance).

The 2026-08 **deck overhaul** is re-cutting each one so it owns a *mechanical axis rather than a
stat spread* (vault: `Deck Design Blueprint`). Done: The Red Mark, Hivebrood, Skyfire. Duneforged is
deliberately **last** — it defines no cards of its own, so it can only be given an axis once the
pool it borrows from is finished.

### The Red Mark — first blueprint deck (2026-08-03)

The eighth registered deck, and the first built to the vault's **Deck Design Blueprint**: a deck should
own a *mechanical axis*, not a stat spread. The Red Mark owns **board structure**.

An elite marksman company that defected. It fights in **two ranks** — a front line of `Anchored`
bodies screening `Ranged` archers behind them — and the formation is the mechanic, not the flavour:
a range-2 shooter cannot hit an adjacent enemy, so **the front rank IS the archers' range band, made
solid.** Lose it and every bow switches off.

```
   . A A A .    A = archers (range 2)
   . F F F .    F = front rank, Anchored
   . e e e .    enemies cannot reach A without eating F
```

- **Leader** *Sable, the Oathbroken* — ATK 20, **range 2**: the first ranged leader. Reach buys a
  band to hold, not safety; anything that closes turns its attack off. Its ability **Marks** a target,
  and `Marked-Warden Tarr` is the payoff — the deck's name is mechanically true.
- **Signature line** enemy closes into the dead zone → *"Fall Back!"* pushes it to exactly 2 → volley.
- **Stated cost** it never clumps, so it forgoes **flanking** entirely.
- **Stated weakness** displacement scatters the ranks; area damage punishes tight formations. Both
  answers already exist in other decks without having been designed as counters.

It also brings **exact-range Ranged** to life — before this, no card used `range > 1`.

### Skyfire — the mobility deck (rebuilt 2026-08-08)

Third deck of the overhaul, and the first content built on **`favoredTerrainMove`** (adopted
2026-08-06: a unit on its own favored terrain moves 2 instead of 1). Everyone else moves one tile;
Skyfire **builds ground it moves two on**, and every card is about arriving.

The engine is a body carrying `OnMove → PaintTerrain Mountain → TilesMovedThrough`. `interpolatePath`
is destination-*inclusive*, so the bird paints the tile it lands on — which means it bootstraps:

```
 turn 1   on Normal, move 1   ->  the tile it LANDS on becomes Mountain
 turn 2   on Mountain, move 2 ->  paints both, ends on Mountain
 turn 3+  permanently a 2-mover, dragging a ridge behind it
```

- **Leader** *Kaelen, the Ashwing* — the punish-passive (+5 against a defender that did **not** move
  on its own turn) is the thesis: a mobile army exists to catch a static one.
- **Signature line** an Ashridge Tyrant that reached its own ridge swings at **65** — 45 printed,
  +10 from Mountain, +10 from its own on-favored-terrain aura.
- **Stated cost** it gives up **reach entirely**. Not one card in the deck has `Ranged`.
- **Stated weaknesses** the road is *public* (Dragon and Machine favor Mountain too, so Dragonspire
  runs on it); **Sea is Avian's weak terrain and Tidecaller paints Sea** — one spell erases the road
  and applies −10; movement denial (`Snared`, `Anchored`) switches the deck off.
- First card anywhere to use the **`OnTerrainPainted` (Terrainfall)** trigger, added 2026-08-05 and
  unused until now.

Two findings worth carrying forward. **(1) An axis has to be visible to the AI evaluator or no A/B
can measure it.** `extraMoveTile` is 0 in the default weights — instrumented self-play prices a
`GrantMove` spell at −6, so the bots never cast one outside Expert. This deck works because its
mobility comes through the **legal-move generator** (favored-terrain reach needs no weight at all)
and through Mountain's +10 ATK, which `effectiveAtk` already prices; where a card *does* grant
movement it is paired with an eval-visible effect on the same card. **(2) `Ranged` at range 1 is
near-dead text** — retaliation-requires-reach is satisfied by adjacency, so the old deck took 0.50
ranged attacks per game and its shooters' "had a legal shot" rate (33.9%) was *exactly* its
"was engaged" rate. Stripping it was DC-neutral, since `rangeDc(1)` is 0.

Measured: **42.8% → 63.9%** on a 3240-game ladder, 7th of 9 to 4th, with all eight matchups improved
and no stalls.

## Play (hotseat)

Click a unit → highlighted tiles are its legal moves; moving onto an enemy is an attack, onto a registered fusion partner is a fuse. Hand cards have `summon` / `cast` / `set` buttons; target-bearing spells and abilities then ask you to click target tiles. Units show **live effective ATK** (recomputed continuously — watch it change as terrain is painted under them). 💧 = active spring, 🕳️ = dormant. `End turn` passes the seat.

## Maps

Six built-in maps in `src/engine/content/boards.ts`, written as ASCII pictures (rows top-down,
so the literal reads the way the board renders). Every one is held by test to the same
`validateBoardLayout` bar a player's custom map faces — **symmetric across the centre row,
springs fixed at (2,4)/(6,4) on Normal ground with mixed rings, no leader walled in, and at
least two crossings of the centre row** so a single body can never shut the game down.

| Map | The question it asks |
|---|---|
| **Arena** | The standard ranked map — every archetype's terrain, seeded symmetrically. |
| **Crossroads** | Open maneuver, no walls. Forest flank vs Mountain flank, Grassland spine. |
| **Highlands** | Mountain corners for the heavy cluster, a Sea channel that punishes them mid-board. |
| **Twin Passes** | Walled centre row: every crossing is a chokepoint, two of the three are springs. |
| **The Gauntlet** | Three lanes joined only at the centre row. Pick a side and live with it. |
| **Sanctum** | Sanctuary highway vs Shadow corners — the anti-dark map, with pillar cover. |

Design basis: the vault's map rules (Board & Grid, Springs, Terrain System) plus standard
competitive practice — mirror symmetry so fairness is *visible*, multiple routes rather than one
corridor, chokepoints that create hotspots instead of dead ends, and a fast centre lane that is
deliberately unrewarded. Each map takes one clear identity so the pool reads as different
questions rather than one map reskinned. Terrain identity leans on the type chart: Sea and
Sanctuary are the two weakener terrains, Mountain/Desert/Forest are cluster homes, and Grassland
favours Warriors alone — which is what makes it the natural surface for a neutral highway.

### Random maps

The board picker adds two modes:

- **🎲 Random saved map** — rolls one of the saved maps (built-ins + your custom ones) at start.
- **🎲 Generate a random map** — a fresh procedural layout. Terrain is grown in blobs (per-tile
  noise plays as uniform mush; clusters are what create ground worth standing on), mirrored
  across the centre row, then springs, spring rings and leader starts are repaired and the
  result is rejection-sampled against the validator — so a generated map is always
  ranked-eligible. **Reroll** draws a new one, and the map you see is the map you play.

The picker previews whatever is selected — built-in, custom, or generated — with its
ranked-eligibility line. Random saved map is the one selection with no preview, because it
resolves to a different map every start. Whichever mode you use, the map's name shows in the
in-game status line. Online lobbies offer the built-in pool too (the full board travels in the
start payload); the random modes are local-only, since both clients must agree on one map.

The **Board editor** has a **🎲 Randomize** button alongside *New from Arena* / *New blank*: it
rolls a generated layout onto the canvas as a starting point to tweak and save. Like the other
two it deselects first, so a reroll can never overwrite a saved board by accident.

## Wall terrain

`Wall` is impassable terrain. No unit may **enter, pass through, or be deployed onto** a Wall,
and no face-down card may be placed on one — summons, sets, raises, token spawns and moving a
face-down card all refuse it, movement cannot route through it, and a push or pull halts on the
tile before it. Walls carry no ATK/DEF terrain modifier.

The exception is an effect that explicitly grants passage, by either route the rule allows:

- the **`Wallwalk`** keyword, from the unit's own card;
- a **`GrantWallPass`** effect from any other card, which applies a timed `WallPass` status.

A unit with passage may enter and cross walls freely. Note the knock-on: a unit standing *on* a
wall can only be reached by another wall-passer (or by Ranged / an effect).

**Conventional terrain painting cannot overwrite a Wall** — painting an area leaves the wall
tiles standing and says so in the log. That immunity is the part exposed as an experiment:
**Rules experiments → Board & combat → Walls repaintable** turns it off so painting levels
walls instead.

Paint walls in the **Board editor** (`Wall` is the last palette swatch). The layout validator
flags the two ways walls break a map: a leader start that is walled in, and walls that seal the
board so the two starts cannot reach each other. The standard Arena map has no walls.

## Two-stat combat — ATK and DEF

Every unit carries **ATK** and **DEF**, and a face-up unit may spend its action to switch
**stance**. In attack stance it fights the way it always has. In **defense stance** it cannot
move or attack, and an attack on it resolves against its **effective DEF** instead of its ATK:

| | outcome |
|---|---|
| **A > D** | defence broken, the defender is destroyed. LP passes **only** if the attacker has `Piercing`, which tramples the whole margin (A − D). A non-piercer takes the piece and nothing else. |
| **A < D** | the wall **holds** and **reflects** (D − A) to the *attacker's* owner. No counter-kill — a wall punishes what it turns away, it does not destroy it. |
| **A = D** | the wall holds. Nothing happens to either side. |

A melee attacker **closes to contact before it strikes a leader** (2026-08-16): a unit with 2+
movement used to chip LP from wherever it stood, because the leader branch never advances (you
cannot take a leader's tile). It now walks its route and stops on the last tile beside the leader,
which puts it in reach of everything around that leader next turn. Ranged attacks still fire from
where they stand — that is the whole point of the keyword.

Flanking still boosts the attacker (walls crack by numbers) but **DEF never flanks** — a
defender is holding a tile, not massing on one. A **face-down unit holds the stance it was set
in** (2026-08-16): concealment is not a posture, so only a hidden unit set in *defense* resolves
on this table, and the stance survives either reveal path — an enemy attacking it or its owner
flip-summoning it. The back is identical whatever the stance, so the universal bluff is intact.
Leaders never take a stance and carry no DEF; they are attacked attritionally, as before. A
helpless defender (`Stunned`, `Disarmed`, or simply out of reach) still *holds* — denying the
counter is not a free break — but it reflects nothing.

**`Piercing` converts overkill into LP, and buys nothing else.** It does not reduce, ignore or
bypass any DEF, so a wall taller than your ATK stops a piercer dead and reflects on it exactly
as it would on anything else. That is what makes its +1 DC honest: the keyword buys reach *past*
the body, never a discount *on* the body.

**A leader attacking a defending unit resolves on this same table** (ruling 2026-08-04). The stance
is a property of the *defender*, so it cannot mean one thing against a body and nothing against a
leader — which is what it did until this ruling, because `resolveCombat` took its
`attacker.isLeader` branch first and resolved against the defender's ATK. The vault's split
survives intact rather than breaking: *binary for units* still decides the piece (a leader breaks a
wall it out-stats and takes no LP for it, since leaders carry no `Piercing`), and *attritional for
the leader* still bills the leader — now as the wall's reflect onto its own pool. The one carve-out
is flanking, which leaders neither grant nor receive, so an attacking leader gets no flank bonus
against a wall. A leader fighting a unit in **attack** stance is completely unchanged, including
its full-ATK strikeback.

Note the trade this creates, which is a feature: against a leader, holding in defense reflects only
the **margin**, where surviving in attack stance strikes back for **full ATK**. Defending a leader
away is not automatically right.

Ratified **2026-08-04**, promoting the 2026-07-21 `DEFENSE_EXPERIMENT` prototype into the core
rules and deleting its four tunables. Three of them were settled at 0 by measurement — a
non-piercing break concedes no LP (`overflowFrac`, falsified twice), a failed break chips
nothing (`failChipFrac`, near-null at both doses) — and the fourth, the piercing model, was
explicitly *unanswerable* by self-play (2.5% of outcomes, all of it LP attribution) and was
settled on design instead. The rule above has no knobs.

### DEF is priced on its excess, not its size

Every registered deck now prints a DEF on every unit. That was affordable because the DC rubric
charges armour **relative to `round(atk/2)`** — the fallback the engine has always given a card
with no printed DEF. That much armour is the body you already had, so it costs nothing, and only
the excess is billed:

```
excess = def − round(atk/2):   ≥45 → +3 DC,  ≥30 → +2,  ≥15 → +1
```

Deliberately asymmetric: a glass cannon gets **no rebate** for printing DEF below the line.
Paying people to dump DEF would just fund wider aggro decks, and the drawback is already priced
by the board — a low-DEF body simply cannot hold a tile. The premium is also what keeps a
fortress deck unbuildable: a wall's excess is most of its statline, so forty of them bust the
110 cap long before they reach the board (asserted directly in `defenseMode.test.ts`).

### The DEF content pass (2026-08-04)

DEF was used as a balance lever, in the direction the 2026-08-03 ladder asked for:

| deck | DC | what its DEF says |
|---|---|---|
| Hivebrood | 90 → **105** | the pass's biggest buff, spent from 20 points of headroom the swarm never used. Bulwark Beetle 30/45, Hive Warden 35/35 — the hive digs in. |
| Skyfire | 99 → **104** | birds are the softest bodies in the deck; Pyre Warden (35/35) is what the flock stands behind. |
| Tidecaller | 104 → **109** | control needs one wall, not thin armour everywhere: Brineguard Sentinel 30/45. |
| The Red Mark | 107 → **109** | Ironhedge Pavise 45/**50** — the front rank finally holds what it screens, which is the deck's whole thesis. |
| Wildgrowth | 109 → **110** | +1, and only on the Anchored fusion. Beasts charge; they do not hold. |
| Dragonspire | **109** | +0. Every dragon prints *under* the line, Sky Sovereign at 60/20 — the ladder's strongest deck now says in stats that it wins races, not ground. |
| Gravemarch | **110** | +0, no headroom. Attrition trades bodies. |
| Duneforged | **95** | +0 — it is composed entirely of other decks' cards, so it inherits their DEF and keeps its 15 points of unspent headroom. |

⚠ **Every per-deck win rate on record predates this pass**, including the 2026-08-03 ladder.

## Ranged — exact range

A `Ranged` card fires at **exactly** its `range` in orthogonal tiles, never nearer. Range is a
number on the card (`range`, default **1**), not a keyword variant — so the keyword dictionary
stays small and every card authored before this existed is unchanged.

- **The dead zone is the mechanic.** A range-2 shooter cannot hit an adjacent enemy, so closing
  the gap is what melee does to an archer. A shooter caught inside its own range falls back to
  an ordinary melee attack (move onto the enemy) and pays the usual exposure cost.
- **Orthogonal only**, per the locked 4-directional attack rule — a shooter has exactly 4 target
  tiles, and the line of fire is a straight line.
- **Walls block the shot.** Only tiles *strictly between* matter; a wall-passer standing on a
  Wall is still shootable, which keeps the standing rule that Ranged is how you reach one.
  Units do **not** block.
- **Retaliation requires reach.** A defender hits back only if it could itself attack the
  attacker's tile — the same principle as *striking back is attacking*, one step further out. A
  melee attacker came to the defender, so it is always in reach; a shot from 2 tiles is answered
  only by something that also reaches 2 (an archer duel). Mismatched ranges do not trade.
- Range is priced in deckbuild at **+1 DC per tile beyond 1** (`rangeDc`). It was +2 until
  2026-08-03, set on the theory that reach is the strongest dial a ranged card has. The first
  ranged deck measured that and it was wrong — not because reach is weak, but because expected
  value is power × **uptime** and only power had been priced. Exact range covers four tiles, and
  `npm run diagnose` found archers hold a legal shot just **24% of turns** (93% of shots taken
  kill, so the ability is strong and *rare*). At +2 that put 18% of a deck's budget into something
  that mostly could not fire. Reach is also the one premium with a built-in drawback — the dead
  zone — so it should not price at the full rate.

Select a Ranged unit in-game and its shot targets appear as **ringed** tiles, distinct from the
filled move highlights. (Before this, the UI had no way to make a ranged attack at all.)

⚠️ **No shipped card uses range > 1 yet**, so the mechanic is inert until content is authored
for it — same self-gating as sigils.

## Crowd control — the denial axis

A unit's whole action surface is *move* and *attack*, and because **move is attack** those
overlap for melee. So the denial vocabulary is three points on one axis rather than three
unrelated effects:

| Status | move | attack | strike back | Its natural counter |
|---|---|---|---|---|
| **`Snared`** | ✗ | ✓* | ✓ | **being `Ranged`** — a shooter fires from where it stands (*melee still can't reach) |
| **`Disarmed`** | ✓ | ✗ | ✗ | **retreating** — the legs still work |
| **`Stunned`** | ✗ | ✗ | ✗ | — the premium: both halves at once |
| **`Suppressed`** | ✓ | ✓ | ✓ | — denies **text**, not actions |

**`Suppressed`** silences a unit's own printed rules *and* its keywords: Frenzy stops adding ATK,
`Anchored` stops refusing displacement (the Suppress→Push combo on a wall), `Guard` stops
intercepting, `Wallwalk` stops opening walls. Continuously re-evaluated via `hasKeyword`, with no
mutation of `keywords` — the printed list stays intact so the status expires cleanly. A `WallPass`
*status* survives suppression: it came from another card, and suppression silences only this
unit's own text. Leader auras targeting a suppressed unit still apply, for the same reason.

**Striking back is attacking**, so a unit that cannot attack cannot strike back either — the
`strike back` column above is not a separate rule, it is the `attack` column. Attacking a
`Disarmed` or `Stunned` body is therefore free.

Unit combat has no discrete strikeback step (it is a single effective-ATK comparison, and the
defender "counters" purely by winning it), so the phrase had to be *given* a meaning:

- the helpless defender **loses ties** — an equal-ATK trade is no longer mutual destruction;
- an attacker that cannot break it **bounces off**: no death, no overflow, no advance;
- winning outright is unchanged (kill, overflow, advance);
- it holds for melee, `Ranged`, a leader's own attacks, and the defense stance (where a stunned
  wall still *holds* but reflects nothing — denying the counter is not a free break).

That makes the axis a **trade-off, not a ladder**: `Snared` pins a body in place but leaves it
dangerous to touch; `Disarmed` makes it harmless to touch but lets it run. `Stunned` is the
premium precisely because it is both at once — a stunned body is pinned *and* free to kill.

**Stun repricing (2026-08-03).** After three successive buffs — duration fixed to a true 2 turns,
then blocking Ranged and stance, then cannot-strike-back — a 2-turn Stun is near-removal, so the
five stun cards moved off their old DC 2 / SP 2:

| Card | Kind | Was | Now |
|---|---|---|---|
| Pin Down | spell (pays SP) | DC 2 / SP 2 | **DC 3 / SP 3** |
| Snare Vine, Shadow Snare, Ambush Run | trap (no SP) | DC 2 | **DC 4** |
| Whirlpool Mine | mine (no SP) | DC 2 | **DC 4** |

Traps and mines sat a point above the spell because DC was their *entire* price — the vault's own
curve. Three decks then busted the 110 cap, which is the rubric working as intended: Wildgrowth
could no longer afford three copies of a premium trap (trimmed to 2), and Anvil and Mixed each
gave up one duplicate body. Totals were then Wildgrowth 109, Tidecaller 104, Anvil 109, Mixed 110.

⚠️ **The trap/mine half of that table was rebated on 2026-08-09** — see *Setting a trap costs SP*
below. Snare Vine and Ambush Run are now **DC 3 / SP 3**, exactly the Pin Down line.

## Setting a trap costs SP (2026-08-09)

A trap prints an `sp` cost and pays it **when it is set face-down**, not when it fires.

Firing is not a payable moment: a trap is reactive and opponent-only, so it springs on the
*opponent's* turn, when its owner's pool has already been zeroed. The commitment is the only thing
the owner can be charged for. **Mines** (a face-down located spell that enemy contact can spring)
prepay at set for the same reason — and are deliberately **not** billed again if their owner flips
one up by hand instead of waiting for contact. A **travelling board spell** is the one face-down
card still set for free: only its owner can ever activate it, so it keeps paying at the flip.

Why bother: while a trap was free, setting one was **strictly additive** — the whole non-unit cap
could be filled on the same turns that spent every point of SP on bodies, so the only real question
a trap asked was a deckbuild one. Now a trap competes with a summon for the same turn.

The DC surcharge above came off in the same pass: it existed *because* traps were free, so a trap
now prices like the spell that does the same thing. Deck budgets barely moved (Wildgrowth 109 →
108); the economy the card taxes did. Prices are ~SP 1 for a DC 2 zone/reaction punish, SP 2 for a
DC 3 status, bigger shove or **negate**, and SP 3 for the two 2-turn stun traps.

One consequence to watch in playtest: a trap is now a **worse bluff**, because the SP it costs is
public information. Spending 2 SP and setting a card narrows what the back can be.

⚠️ Not yet measured. This is an economy change to a card class the bots do use, and no A/B has been
run — every per-deck ladder number on record predates it.

`setSpCost()` in `engine.ts` is the single answer for what a set costs, shared by the engine, the
legal-move generator, the bot's affordability check and the UI, so the four cannot drift.

⚠️ `Disarmed` has NOT been repriced — no shipped card applies it yet. And if playtest still finds
Stun too strong at these prices, the next lever is **duration (2 → 1)**, not more DC.

All four are **denial statuses**, so leaders are immune to all four (see below), they all refresh
rather than stack, and any of them can be carried by a **sigil**.

## Sigils (marked ground)

A **sigil** applies a timed status to any unit that **enters** its tile. It is a tile *marker*,
not a terrain — like a spring, it rides on top of whatever ground is already there, so the tile
keeps its own type-vs-terrain ±10 and a sigil on Forest differs from one on Mountain.

- **On entry only, never while standing.** This is load-bearing rather than cosmetic: a
  while-standing stun would mean the victim cannot move, therefore cannot leave, therefore is
  stunned forever. Entry-only means the status ticks out on the normal clock and the unit walks
  away. Every arrival counts — a plain move, a displacement, or an advance-on-kill.
- **Painting the tile wipes it.** Turning the ground over destroys the marking; that is a
  sigil's counterplay. A paint *refused* on a Wall does not wipe it. (Fun consequence: a
  terrain-painting leader like Briar clears the sigil it just triggered.)
- **Leaders are CC-immune, and are billed in LP instead.** A leader that could be locked down
  could not flee, answer, or be played around — the whole game routes through one piece. So a
  sigil charges a leader `Sigil leader LP` (default 10) straight off the pool and applies no
  status, whatever the sigil carries. That matches the vault's core split: *binary for units,
  attritional for the leader.* A sigil can be lethal to a leader already at low LP.
  The immunity sits at the `applyStatus` chokepoint, so it holds for **every** source — spells
  and traps that would stun a leader simply fizzle. Stat mods (`AtkMod`/`DefMod`) are **not**
  crowd control and still land: a leader's ATK is load-bearing as its anti-swarm rating.
- **`Stunned` refreshes rather than stacks** — re-entering takes the longer duration instead of
  queuing a second copy, so a sigil cannot chain-lock. Numeric `AtkMod`/`DefMod` still stack.

Place sigils in the **Board editor** with the ✦ tool beside the spring tool; the spec panel
picks the status, amount and duration, and the mirror toggle stamps a matching pair. Tiles with
no explicit spec fall back to **Rules experiments → Board & combat → Sigil status / amount /
duration** (default: a 2-turn stun); the fallback is baked into the board when the game starts,
so a saved map always states its own sigils outright. `Sigil duration` 0 makes them inert.

The layout validator warns when a sigil **sits on or rings a spring** (that would make the
spring uncontestable, breaking the vault's "first grab isn't first keep"), when one sits on a
**Wall** (nothing can ever enter, so it could never fire), and when sigils are **unmirrored or
mirrored with different effects**. No built-in map carries one, and the random generator never
produces them.

### Gravemarch — the recursion deck (rebuilt 2026-08-08)

Fourth deck of the overhaul, and the first built on the card-choice pass. Its axis is **recursion —
the graveyard is a resource you spend and refill** — and the old build did not deliver it: a probe
found Raise was unavailable because **the graveyard was empty on 73.7% of turns**. Not the summon
ring (3.2%), not the unit cap (1.9%). The deck called itself a recursion deck and never filled its
own pile.

**Two tribes, two jobs**, and the split is the design rather than a compromise:

| | job | fate |
|---|---|---|
| **Insect** | cheap bodies that die eagerly and pay on the way out | enter the grave, **never** return |
| **Undead** | bodies priced to be raised again and again | enter the grave and march again |

`TypeInOwnGraveyard` takes a type, so the deck runs **two piles with two payoffs**: Ossuary Warden
grows off buried Undead (the raise pool), Charnel Host off spent Insects (gone for good), and
Vessik's aura carries both. Every payoff is on `OnDeath`, never `OnSummon` — raises deliberately skip
OnSummon, so a body whose value is on death **pays every time it dies**.

**⚠ Husk tokens are gone**, and that is the structural change: tokens vanish and never enter the
graveyard, so token generation is off-thesis for a deck whose currency *is* the graveyard — and it
was the overlap with Hivebrood. The contrast is now one line: **Hivebrood eats TOKENS** (gone
forever, converted to permanent counters — it COMPOUNDS); **Gravemarch eats REAL CARDS** (they land
in the pile, get counted, and if Undead they come back — it RECURS).

Measured **59.2% → 76.7%** (3240-game ladder), 5th of 9 → 2nd. Empty-graveyard turns 73.7% → ~45%,
Gather the Dead 1.97 → 3.03 uses/game. It fields the **lowest printed ATK in the pool** (27.7 vs
30.6) and the **highest effective ATK in play** (43.4 vs 39.6) — which is exactly the shape a
recursion deck should have.

Three findings worth carrying forward:

- **⚠ A leader's `AuraAtkPerCount` was silently inert.** `effectiveAtk`'s leader-aura loop tested
  only `AuraAtk` while `validateLeader` happily accepted the scaling form, so a leader printed with
  one parsed, type-checked and did nothing — the exact defect class the validators exist to catch,
  hiding in the gap between them and that function. Fixed; Vessik was the only leader affected.
- **The evaluator will not sacrifice.** A "destroy your own body for value" outlet measured **0.00
  casts/game**: a lost body scores at roughly `unitAtk × ATK + unitLevel × level` (~53 for a 25-ATK
  2-drop) and no realistic payoff outweighs it. The card was cut rather than shipped as dead DC.
- **A pure tutor is eval-neutral by construction** — it trades a known card for a known card, then
  costs SP. Call the Roll only became castable (0.00 → 0.72/game) once a `Draw 1` was paired onto
  it, the same trick Skyfire's Ember Wake uses.

⚠ At 76.7% it is the strongest of the reworked decks and sits 2nd overall; it likely wants one more
balance pass. Recorded for whoever does it: of the levers tried, only **printed ATK** moved the
number materially (−5 across the curve was worth −7pp). Draw density, SP refunds, the leader ability
cost (5→6→8) and the scaler sizes were all **within noise** at 360 games a row (±5pp).

### Tidecaller — the undertow (rebuilt 2026-08-08)

Fifth deck of the overhaul, and the sharpest diagnosis yet: **its stated combo was mechanically
impossible, and the half that worked belonged to another deck.**

- ATK per DC **5.55** vs a field of 7.67 — the worst in the pool, on 20 bodies vs 25, with **48% of
  the budget** on 20 spells and traps.
- Enemies stood on Sea **13.0%** of the time while Sea covered 16.7% of the board — *below chance*.
  Displacement direction is pure geometry (`Push` away from the origin, `Pull` toward it), never a
  chosen destination, so a shove cannot be aimed at a tile.
- Its own Aqua stood on Sea 65.3% of the time for +10 — paint-terrain-and-stand-on-it, which is
  **Wildgrowth's axis**.

**Axis: THE UNDERTOW — displacement into a prepared kill zone.** Two findings shaped it, and the
second overruled the first:

1. **It must pull, never push.** `SetCard` is only legal on the leader's own 8-ring and a set card
   crawls one tile per turn, so your minefield is always around your own leader — a push sends
   enemies away from it. The old build's most-used effect was Neris's `Push 1 → Area3x3` at 2.91
   casts/game, shoving enemies out of the very trap field she stood in. That sign is now flipped.
2. **⚠ But your own drag can never spring your own trap.** `fireTraps` opens with
   `const defenderSide = s.active === 0 ? 1 : 0` — only the *non-active* player's traps are armed,
   which is the vault's locked "traps are reactive, opponent-action-only". The obvious fantasy (cast
   a drag, haul someone into your minefield) is unreachable.

So the deck is **reactive**, and that is the better fiction: you do not drag them in; they come to
the water and it takes them deeper. The engine is a verified chain — an intruder steps into the
zone, Drowned Grasp fires, **Undercurrent fires and pulls them a tile deeper, and that displacement
is itself an entry, so the next trap fires too.** Undercurrent was a *push* before this pass, which
threw victims back out of the zone. The proactive drags are setup: they park an enemy inside the
zone so the minefield answers the moment it moves.

Mines are excluded by the same geometry — nothing can be shoved onto an occupied tile — so the
payoff layer is zone traps only, and `whirlpoolMine` is gone. Mistcaller is the **first card in the
game to read `OnTrapTriggered`**, a trigger that had been unused since the 2026-08-04 vocabulary pass.

Measured: **62.2% → 68.9%** (4th of 9), traps fired 2.94 → 5.59/game, and displacement-that-sprang-a-trap
0.03 → 0.22/game. ⚠ At full strength it hit **82.2%** — better than any deck in the game — so it gave
5 ATK back across the whole curve and finished deliberately **under the cap at 105 DC**.

### Wildgrowth — the bramble maze (rebuilt 2026-08-08)

Sixth deck of the overhaul, and **the first with a bring-it-down mandate.** The five before it all
raised their deck; Wildgrowth sat 3rd at 72.2% having never been touched.

**Its curve was not the reason — it was dead average.** ATK per DC 7.45 against a field of 7.57,
mean printed ATK 30.4, which is *exactly* the field mean. One number was not average:

| | Wildgrowth | field |
|---|---|---|
| mean printed ATK | 30.4 | 30.4 |
| **mean EFFECTIVE ATK in play** | **53.3** | **38.9** |

The gap was a **documented rules discrepancy nobody had balanced around**. A leader's "+10 to my
type on my terrain" passive **stacks with the terrain chart's own +10**, so standing on your own
paint is worth **+20** — Thornfang prints 30 and fought at 50 on Forest. `stats.ts` has carried the
note for months: *"the sim notes' arithmetic mostly counted a single +10."* Wildgrowth painted 20%
of the map and stood on it 56% of the time, for **+16.6 ATK on every body, invisible on every card.**

⚠ **Exactly three leaders carry that passive: Briar, Vharos (Dragonspire) and Oskar (Duneforged).**
Only Briar's is fixed here, deliberately, so this pass's effect stays attributable — the other two
are recorded in the vault's Open Threads as a live balance item, and both of their decks are still
unreworked.

**Axis: TERRAIN CONSTRUCTION — the deck builds the board's topology, not its stat modifiers.**

`PaintTerrain 'Wall'` and the `Wallwalk` keyword were both live engine vocabulary that **no card
anywhere had ever used**, and they are two halves of one idea: the brambles close the board to
everything except the things that grew them. Walls come from **bodies that die** — `destroyUnit`
fires `OnDeath` after removal, from the death position, so `OnDeath → PaintTerrain 'Wall' →
ThisTile` roots a thicket where the body fell. Self-limiting by construction: one wall per body you
lose, each paid for with a card.

⚠ **Walls are permanent** — `RULES.wallsPaintable` is false, so nothing can ever clear one, and a
card painting Wall bypassed every anti-degeneracy rule `boardLayout.ts` enforces at map-build time.
Two engine guards close that:

- **`wallWouldSeal`** refuses a Wall paint *for that tile* (the rest of the effect resolves) when it
  would land on a leader, leave a leader with no open ring tile, or disconnect the two leaders — a
  BFS over non-Wall tiles, reusing the map validator's rules. It fires ~0.03×/game: a floor, not a
  lever.
- **`advanceAfterKill` gained a `canOccupy` check.** It never needed one before, because terrain
  could not change mid-combat. Without it, a killer advances onto the tile whose thicket it just
  created and stands inside impassable terrain. The kill stands; only the advance is denied.

⚠ **A proactive wall spell measured −9.5pp and was cut.** The Verdant builders deliberately have no
`Wallwalk`, so a *chosen* wall is as likely to cage the caster as the target — and a one-ply bot
cannot make that topology call. Reactive walls are safe because they land where a body already died.
That cut is why the honest scale of this axis is **2.2 walls in a peak game**: a lane re-cut, not a
maze. The deck comment says so out loud.

Measured: **72.2% → 63.3%** (3rd → 4th of 9), and the number the pass existed to move — **effective
ATK 53.3 → 42.2 against a field of 41.1**, from +14.4 clear of the pool to parity with it.

> **Printed ATK has now misled this project twice** — here, and on Red Mark, where the archers were
> already above the field and only the front rank was short. Measure what a card *fights at*.

### The SP curve: 4/7/8 → 4/5/6/7/8 (adopted 2026-08-09)

`spStep` went **3 → 1**. The cap is unchanged at 8; only the ramp to it slowed.

| turn | 1 | 2 | 3 | 4 | 5+ |
|---|---|---|---|---|---|
| was | 4 | 7 | **8** | 8 | 8 |
| now | 4 | 5 | 6 | 7 | **8** |

**The old curve finished on turn 3.** From then on the most expensive body in the game was
affordable every single turn, forever — so across a 13-round game the economy was a non-factor for
ten of them. It now ramps across the first third, and an 8-cost body is something you build toward.

**Adopted for feel, not balance, and the distinction is the honest part.** Measured over 1,620
games/arm it is balance-neutral: every per-deck delta sits inside the ±5pp band and the ladder
spread goes 51.1 → 51.9pp. Health is flat or slightly better — stalls 0%, fatigue 2.2% → 2.0%,
decisive 100%, rounds 13.0 → 13.7, summons and overflow up slightly. What it changes is timing:
**the first 6+ SP body arrives round 5.3 instead of 3.4, while 6+ bodies played per game is
unchanged at 2.86.** Delayed, not suppressed.

⚠ **`spStep: 2` is a trap** — 4+2+2 = 8, so it still unlocks on turn 3 and changes nothing. Only
step 1 delays anything.

⚠ **Every A/B number recorded before 2026-08-09 was measured on the 4/7/8 curve.** To reproduce an
old baseline, set `spStep: 3`; tests do it with `withLegacySpCurve()`, which is how the sim
transcripts keep testing the rules they were recorded against.

**A slower curve was rejected.** `3/1` (top end on turn 6) read a 46.3pp spread against the 51.1pp
baseline, which looked like ladder compression — but it came from two decks moving by amounts each
individually within noise, and both mechanisms proposed to explain it were falsified on inspection.
It is not a compression lever, and 4/1 buys the same feel change for less.

### Guard, re-spec'd as a pin (2026-08-09)

`Guard` used to be an unshipped **interception** experiment: a Guard beside its leader redirected
attacks aimed at that leader onto itself. It was never enabled, and its A/B was **vacuous — 0/3840
outcome changes** — because no card in any deck carried the keyword, so the flag had nothing to act
on. Meanwhile the vault had already moved on: `Crowd Control & Status Effects.md` describes Guard as
*"you cannot walk past me"* and rules taunt out on the grounds that Guard "already does the useful
half". The engine never followed. It does now.

> **Guard (pin).** While a unit stands orthogonally adjacent to an enemy Guard, it may not end a move
> on an **empty** tile that is not also adjacent to that Guard. **Attacks are unaffected.**

**Restricting only moves-onto-empty-tiles is what makes it safe.** Movement *is* attacking here, so a
pinned unit can always swing at the Guard, always shuffle to its other tiles, and always pass. It is
pinned, never frozen. The CC note's warning that while-standing movement denial *soft-locks* was
about denial **statuses**, where the victim can do nothing at all.

Rulings: leaders **are** pinned (the leader CC-immunity fizzles denial *statuses* at the
`applyStatus` chokepoint; a pin is a positional fact, not a status). Tokens and summoning-sick units
do not Guard. `Suppressed` switches it off free. **Push/Pull ignore it**, so displacement is the
counterplay and `Anchored` answers that. Two Guards intersect. The interception code, its flag, its
`rangedPierces` sub-lever and the whole "Prototype rulesets" section of the setup UI are deleted —
Guard needs no flag because it gates itself: no card, no effect.

**The fuzz gate had to be built twice.** A pin is the first rule in the game that can remove a unit's
legal moves, so fuzz is the right gate — but the obvious assertion (`actions.length > 0`) is useless,
because `EndTurn` is always enumerable and passes even under a total lock. The real property is
per-unit: *every pinned unit that can still act has an action of its own*. That version runs 162
games with Guard stamped on **every unit in both decks** and catches a lock with a precise
diagnostic. Its first two failures were both the gate being wrong rather than the rule — a
summoning-sick unit, and the modal hand-cap-burn sub-phase where no unit has actions by design.

Measured with real dosage (one Guard body per deck): **unit-turns pinned 0.0 → 8.8**, stalls 0% → 0%,
win rate +1.6% (ns). A movement-denial rule that does not stall the game.

### Piercing — the counter that did not exist (2026-08-09)

Two-stat combat became core on 2026-08-04, and with it the rule that a braced defender concedes no
LP unless the attacker has `Piercing`. Measured across all 72 ordered matchups:

| | |
|---|---|
| kills producing **zero LP** because the defender braced | **35.4%** (3.76/game) |
| Piercing tramples, meta-wide | **0** |
| braced bodies that HELD and reflected | **0.00/game** |

That last row is the sharp one: stance was never used to *survive* — every braced body still died. It
was a pure damage-denial button, free, available to everyone, and answerable by nothing, because all
four Piercing cards in the repo live in `piercer.ts`, a probe deck outside `DECKS`. The DC rubric
priced the keyword and the combat table named it, and nothing in the playable pool paid for it.

⚠ **It must ride a printed statline, not a grant.** Red Mark tried it as a one-turn command
(`GrantKeyword`, the card is literally named for an armour-piercing arrowhead) and measured **0.06
tramples a game**. `evaluate()` prices effective ATK, effective DEF and statuses; it has no notion of
"this attack would trample a brace", so the bot casts the grant blind. Reverted, and recorded.

### Dragonspire — the overkill deck (rebuilt 2026-08-09)

Seventh deck of the overhaul. It was a self-declared **ceiling probe** ("this deck exists to
stress-test how the game copes with stronger units/effects"), and at 78.9%, 1st of 9, the measurement
came back: it does not cope.

**Its engine was already combat overflow and nothing said so.** 131.2 overflow LP per game against a
field of 52–104, and 73% of all the damage it dealt. `overflow = aTot − dEff` is a pure ATK-margin
rule, so "my body is much bigger than yours" *was* the clock; the old header described the setup
("ramp SP with eggs and tithes") and never named the payoff.

⚠ **And the ramp half was a fiction.** SP refreshes rather than accumulating (`ps.sp =
spMax(ps.turnCount)`), so the allowance is 4/7/8 and frozen at 8 from turn 3 — and **51.7% of all SP
granted across the meta is thrown away unspent**. The ramp package paid into a pile that was already
half wasted and could not be carried forward, so it was cut; the draw half became the deck's real
ramp, because what Dragonspire is starved of is cards.

*(Corrected: an earlier draft of this section claimed "SP is not a resource" on the strength of
banked SP measured at turn start. That sample is taken right after the refresh, so it just reports
`spMax` back — it proved nothing. SP does ration play within a turn; what it does not do is gate the
top end across turns or allow saving.)*

⚠ **The lever is "raise mine", not "lower theirs"** — deliberately. Debuffing the defender is the
obvious way to widen a margin, and it belongs to **Blightshot**, parked in the blueprint queue as
"stat degradation; converts debuffs into a clock via combat overflow". Same payoff rule, opposite
lever, two decks that still play nothing alike.

**Result: 78.9% → 69.7%**, 1st to joint-2nd. The budget came from Vharos's **+20 terrain double-dip**
(Dragon is favored on Mountain, so his passive stacked with the chart's own +10); removing it
outright measured −13.3pp, and it is now a flat +5 gated on `LevelAtLeast`, which had **zero uses
anywhere in the game**.

What landed and what did not, reported together:

| | before | after |
|---|---|---|
| leader active fires | 0.03/game | **3.41/game** |
| overflow LP dealt | 131.2 | 109.8 |
| enemy unit-turns pinned | — | 1.13 (1.38 at Expert) |
| Piercing tramples | 0 meta-wide | 0.16/game |
| fusion | 0.00/game | 0.00/game |

The dead 7-SP leader active is fixed and is now the deck's most-used effect. **The pin is a texture,
not the play pattern** — depth does not rescue it, because a pin only costs the victim something if
it wanted to leave, and two bots marching at each other rarely do. Parked on human playtest, and
deliberately not patched by raising the eval weight. Piercing is under-dosed at one card. The fusion
is dead for the third time and is left as a 3 DC trophy rather than fixed again.

### Red Mark's `screen` verb was inert for six months (2026-08-09)

Its stated verbs are `rank · screen · loose · fall back`. The front line was `Anchored` — *cannot be
dragged out of place*, **not** *cannot be walked past* — so an enemy simply stepped around it into
the archers' dead zone and every bow in the deck switched off. The deck was built for a keyword that
did not exist yet.

Giving the front rank `Guard` fixed the mechanic outright: **2.22 enemy unit-turns pinned per game,
double any other deck's.** It did not fix the deck — 36.7% → 33.6%, flat within noise — because the
screen was never the problem. Printed ATK on board 26.6, effective 36.4, against a field of ~41.
**The stat floor is the problem and it needs its own pass.**

### Ironhold — both halves of its own axis (2026-08-09)

Its axis is STANCE, "the brace/swing decision", and it is last at 25.8% → 27.2%. In a meta where
bracing was free and uncounterable, the decision its identity rests on was not a decision. It now
carries `Guard` on the Shieldbearer (a brace you can walk around is not a brace) and `Piercing` on
the Linebreaker (the card was named for it, and it is the deck's own first stated weakness). The
starter deck's "no advanced subsystems" test now allowlists exactly those two, with the argument
written down — they are not subsystems a beginner should be spared, they are this deck's subject.

⚠ Ironhold is also the **A/B control deck**, so `IRONHOLD_CLASSIC` freezes the pre-pass list for any
experiment that needs the old baseline. It is deliberately not in `DECKS`.

### Effect diversity — spending the unused vocabulary (2026-08-16)

`npm run impact` grouped every non-unit card by its effect body and found the pool was far thinner
than its 53 names suggested: **13 cards (25%) were EXACT duplicates** — same kind, scope, trigger,
effects, DC and SP, differing only in id and name — and under a looser "same shape, different
parameters" key, **24 of 53 (45%)** collapsed into nine shapes. Four decks print the identical
`Draw 2`; four print the identical 30-damage zone trap; three print the identical
"gain 1 SP, draw 1".

The names were doing the identity work that the mechanics were not. Meanwhile a survey of the
vocabulary found the opposite problem: three `Effect` members, six `TargetSpec` members, eight
`Condition` members and seven `Trigger` members had **zero users anywhere**.

Consolidating the duplicates was considered and rejected — `skyfire.ts` already records the reason
("Backdraft is deliberately NOT re-fielded — it is frozen for Duneforged, so a card this deck could
never tune again is a card it should not be building on"), and coupling four decks to one def would
also break `--focus` attribution in the harness. The effort went into new shapes instead:

| card | deck | first user of | why there |
|---|---|---|---|
| **The Tide Turns** | Tidecaller | `AllUnitsOnTerrain` | the deck that MAKES the Sea could never cash it in |
| **Pull It Down** | Hivebrood | `EffAtkAtLeast` | all other removal kills *small* things; the chaff deck owns the inverse |
| **"Hold the Ford!"** | Ironhold | `HoldsSpring` | ⚠ the board's only objective had **zero** card support in nine decks |
| **The Debt Called** | Duneforged | `GraveyardCountAtLeast`, `AllEnemies` | the graveyard was a resource to *spend*, never a threshold to *count* |
| **"Breach the Line!"** | Ironhold | `InDefenseStance` on a spell | bracing had no downside a card could name |
| **Brood Hardening** | Hivebrood | `AddCounter` on a non-unit | replaced a trap that produced nothing on 16 of 20 fires |

Two engine gaps closed on the way:

- **`AllEnemies` is a new `TargetSpec`.** "All enemies" was genuinely unwritable — the only untyped
  enemy targets were `AdjacentEnemies` (a 4-tile shape) and `ChosenEnemy` (one unit), so a
  board-wide effect had to list all thirteen types, which renders as an unreadable card and breaks
  silently when a fourteenth type is added.
- ⚠ **A condition on the wrong effect is dead text.** `execLine` consults `line.condition` in only
  six branches (`Damage`, `Destroy`, `ApplyStatus`, `AddCounter`, `GrantKeyword`, `GrantWallPass`);
  Passive auras honour conditions on a *second, separate* path inside `effectiveAtk`/`effectiveDef`.
  Everything else — `Draw`, `GainSP`, `PaintTerrain`, `Push`/`Pull`, `SummonToken`, `Transform`,
  `GrantMove`, `Search` — ignores it silently, so "draw two while you hold a spring" is unwritable
  and *looks* fine. `validateCardRules` returns `[]` for spells and traps and could not see it. A
  guard test in `content.test.ts` now asserts no registered card does this.

⚠ **Every one of these cards was checked for eval-visibility before it was built**, because the
pool already contains a cautionary tale: `bodkinVolley` was briefly a `GrantKeyword Piercing`
command, measured **0.06 tramples per game**, and was reverted — `evaluate()` prices effective ATK,
DEF and statuses, and has no notion of "this attack would trample a brace", so a keyword *grant* is
invisible to the bot. Destroys, statuses and counters are all visible; keyword grants still are not.

**Measured**, 648 games (`npm run impact`, greedy, arena):

| card | resolutions | what it did |
|---|---|---|
| Pull It Down | 110 (44 hard-cast) | **1.00 kills per cast** |
| "Breach the Line!" | 50 | **1.00 kills per cast** |
| "Hold the Ford!" | 59 | 5.7 bodies permanently grown per cast |
| The Tide Turns | 52 | 2.25 snared per cast |
| Brood Hardening | 12 fires | 5.2 bodies grown per fire |
| The Debt Called | **0** → 32 after a rewrite | see below |

⚠ **THE DEBT CALLED SHIPPED BROKEN AND THE CONDITION IS THE REASON.** Its threshold was six Undead
in the graveyard, reasoned from the deck list ("eleven Undead bodies, and it trades constantly")
and never measured. It resolved **zero times in 648 games**. The measurement:

|  | peak Undead in the pile | games ever reaching 6 |
|---|---|---|
| Duneforged (fields it) | mean 1.1, median 1, max 4 | **0%** |
| Gravemarch (the actual recursion deck) | mean 2.1, median 2, max 6 | **1%** |

A 14-round game does not bury six of one type. ⚠ `GraveyardCountAtLeast` is a near-dead condition
above about **2** anywhere in this pool. The fix was structural rather than a smaller number: one
gated line makes the whole card a blank until the gate opens, and a one-ply bot is *right* never to
cast a blank — so the card was unmeasurable as well as weak. It is now two lines, an unconditional
floor plus a threshold payoff at a count the deck reaches, and went from 0 to 0.59 resolutions per
game at 4.0 enemies debuffed per cast. **A card needs a floor, or the bot cannot tell you anything
about it.**

**Ladder effect** (20 seeds, arena and gauntlet; unchanged decks moved ±1.5pp on arena and ±4pp on
gauntlet, which is the noise floor):

- **Hivebrood +7.8pp arena / +7.2pp gauntlet** — consistent on both boards and far outside noise.
  Pull It Down is the single biggest content change here; it took the swarm deck from 6th to 4th.
- ⚠ **Tidecaller −4.5pp arena / −4.7pp gauntlet** — also consistent, and a genuine regression. The
  Tide Turns was first paid for with a Scry the Depths and an Undercurrent, and 2.25 snares per cast
  did not cover that. **Repriced, and re-measured:** both copies went back, and the cost moved to one
  Drowned Grasp (the 30-damage tier `DAMAGE_FLOOR` measured killing 12% of what it hits) and one
  Tide Priest (the deck's own "deliberately blank" filler).

  |  | arena | gauntlet |
  |---|---|---|
  | before the new card | 70.6% | 73.9% |
  | paid with Scry + Undercurrent | 66.1% | 69.2% |
  | **repriced** | **69.4%** | **67.8%** |

  On arena that recovers the loss — +3.3pp, landing 1.2pp under baseline, inside the ±1.5pp noise
  floor. ⚠ **On gauntlet it does not**: 67.8% is flat against the previous run (−1.4pp, inside that
  board's ±2.2pp run-to-run noise) but still 6.1pp under the original baseline. Gauntlet is the
  noisier board — Red Mark moved −4.4pp between two runs with no card changes at all — so this is
  *unresolved rather than fixed*, and the honest read is that the deck may still be carrying a cost
  on that map. Both restored cards are back in heavy use (Scry 28 resolutions, Undercurrent 36
  fires per 54 games), so the reprice did what it was meant to mechanically.
- Everything else moved inside the noise floor. Meta spread is unchanged at ~49pp.

⚠ **The general lesson, and it cost two ladder runs to learn:** paying for a new card by cutting
copies is a *balance change*, not bookkeeping, and it needs measuring separately from the card
itself. The first Tidecaller trade looked free on paper — a duplicated Draw 2 and a trap measured at
3 kills in 73 fires — and cost 4.5pp anyway.

## Card choice — naming a card, not a tile (2026-08-08)

Every player choice used to be a **tile**: `Action.targets` is a `Coord[]`, and that was the only
channel. So two long-parked things could not exist. `RaiseFromGraveyard` took *the most recent
matching card* (a standing `TODO(open)`), which meant a recursion deck got back whatever died last;
and `Search` mode `'choose'` — a true tutor — was **rejected at load** by `validateCardRules`,
because there was nothing for a player or a bot to choose *with*.

`Action.chosenCards?: string[]` is that second channel, on `CastSpell` / `FlipCard` /
`ActivateAbility`.

- **Card identity, not zone index.** Copies of a card are interchangeable, so an id dedupes the
  bots' action space naturally — three Duneshamblers in the graveyard are *one* choice.
  `legalActions` already dedupes hand cards the same way.
- **A parallel axis, not a bigger `TargetRequest`.** `cardRequest(effects)` and
  `cardCandidates(s, owner, req)` in `targeting.ts` mirror `combinedRequest` / `enumerateTargetSets`
  one-for-one, and `enumerateBoundActions` crosses the two. `targetsNeeded`, which the GUI leans on,
  is untouched.
- **⚠ Additive by construction.** With no `chosenCards`, `RaiseFromGraveyard` still scans back to
  front and takes the most recent match. Every sim suite, every trigger-fired raise, and
  Duneforged's Raise the Fallen were written against that rule.
- **Owner-scoped, so fog is a non-issue.** Both candidate sources are *your* graveyard and *your*
  deck; `sanitize` masks only the opponent's zones, and graveyards are public regardless. Asserted
  rather than assumed, in `cardChoice.test.ts`.
- **Cheap for the bots.** Measured on Gravemarch: **+0.7% mean bound actions** (39.7 → 40.0, worst
  case +12 on 111).
- **The GUI reuses `ZoneModal`** rather than growing a picker. It already renders the graveyard in
  order and the deck grouped-and-name-sorted so draw order never leaks; picking mode highlights the
  legal candidates and greys the rest, so you read the whole zone but can only click what the
  action accepts.

Only two pieces of content field `RaiseFromGraveyard` (Raise the Fallen, and Oskar's ability), so
those two decks — Gravemarch and Duneforged — are the only ones whose play changed, by −0.2pp and
−0.9pp on a 3240-game ladder. A test sweeps every registered deck and asserts nothing else asks for
a card, which is the real containment guarantee.

`Search` mode `'choose'` is now live but **unused by any card** — it is the consistency lever waiting
for the Gravemarch rework.

## Rules experiments (the tester's workbench)

This build is a balance workbench, not a shipping client, so the rules themselves are knobs.
**Game setup → Rules experiments** (collapsed, badge shows how many knobs are off baseline)
holds all of it, applied to the next game you start and then fixed for its lifetime:

- **Prototype rulesets** — flag-gated mechanics: the **Guard keyword** (an adjacent Guard unit
  intercepts attacks on your leader; no registered deck carries Guard, so it needs custom cards
  to exercise). Two-stat combat used to live here; it was ratified into the core rules on
  2026-08-04 and has no knobs left to sweep.
- **Economy** — starting LP, opening hand, hand cap, fatigue step, the SP curve (turn-1 SP, per
  turn, cap), spring SP and recharge.
- **Board & combat** — unit / set-card / token caps, summoning sickness, walls repaintable,
  flank per ally, flank max allies. Summoning sickness is a turn *count*: **0 is the default
  since 2026-08-01** — units attack the turn they land — while 1 is the older rule and 2+ slows
  the board down. It gates attacking, fusing, ranged attacks and stance changes; plain movement
  is unaffected, as always.

Knobs are numbers or checkboxes; both report as a diff and reset the same way.

Everything defaults to the shipping ruleset; off-baseline knobs are highlighted, listed as a
diff under the panel, resettable individually (↺) or all at once, and echoed in an
**Experimental ruleset** panel in-game so a stale tweak can't be forgotten mid-playtest.
**Local games only** — none of this travels in the online start payload, so online matches
always run the shipping ruleset.

The numeric knobs live in `RULES` (`src/engine/rules.ts`) with `RULES_DEFAULTS` as the
baseline; the engine reads them live, so tests and the A/B harness can sweep them the same way.

### Defense mode — the prototype record (2026-07-21 → 2026-08-04)

**This is history.** Two-stat combat is a core rule now; see *Two-stat combat — ATK and DEF*
above for what the game actually does. What follows is the measurement trail that got it there,
kept because the verdicts are the reason the ratified rule has the shape it has.

⚠ **Read every number below as pre-promotion.** They were all measured with the flag on and the
probe decks as the only DEF-carrying content, against a field whose cards printed no DEF at all.
Since then every registered deck prints DEF, the DC rubric prices it relatively, and the probe
decks were re-trimmed under that pricing (Anvil 122 → 109, Mixed 114 → 110). Nothing here has
been re-run.

The three probe decks (Mixed / Anvil / Piercer) are still offered by the deck pickers, now
unconditionally — they are harness fixtures, not ladder entries, and are deliberately degenerate.
All three are deck-legal: 40 cards, ≤3 copies, under the DC cap. Anvil in particular is legal
*because* the DC rubric works — pricing armour as real power means it cannot afford forty walls
and has to buy the rest of a deck to get the ones it wants.

Built out on 2026-07-31 from flat 3-of lists into real builds (18–21 distinct cards, copy counts
1–3 by how early a card wants to be drawn). The first legal versions had structural holes that
made their A/B reads hard to trust: Anvil had no draw, no SP and one trap, so "control deck"
meant "decks itself"; Piercer had no gas and seven interchangeable vanilla statlines; Mixed was
forty units and not one spell. Each now carries the economy, traps and answers a human would
build, and Anvil has reach that does not require walking a wall into a fight (Siege Volley at the
enemy leader, Rampart Ballista shooting from the second rank). Under greedy the head-to-head
moved 0% → 6% for Anvil and games ran about twice as long; under search, 0% → 15%.

**Those two numbers were measured before the shuffle bug was found (2026-08-01) and are not
trustworthy** — see *Bot tiers* below. Every deck was played in literal `list` order, so the
support packages, which sit at the bottom of both lists, were never drawn at all. Re-measure on
shuffled decks before citing them.

#### Card pass (2026-08-02)

The 2026-07-31 build-out fixed what the decks could *do*; this one fixed what their cards *say*.
Eleven of thirteen Anvil bodies and nine of twelve Piercer bodies were bare statlines, and both
leaders were terrain painters wearing an archetype's name — Bastion "the Warden" painted a
Mountain line, which is verbatim the deck's own Entrench Order spell.

Expressing a defensive archetype needed the DEF axis to have a design vocabulary at all.
`effectiveDef` was base + terrain and nothing else, so a warden could not buff DEF and a breaker
could not strip it. DEF now mirrors ATK: a Passive **`AuraDef`** aura (own and leader) and a
**`DefMod`** timed status, both read by `effectiveDef` and both inert while the flag is off.

- **Bastion, the Warden** — passive: friendly Terra/Machine *on Mountain* get +10 DEF, so the
  deck's terraform finally has a leader-level payoff. Active **Aegis** (2 SP, located): +20 DEF
  for two turns, which walks the leader into reach of the line he is shielding.
- **Vanguard, the Breaker** — passive: +5 ATK to friendly Warriors, the half of the deck without
  Piercing. Active **Sunder** (2 SP, located): −20 DEF for two turns, the lever that lets the
  pack/flank lane crack a wall the hard way.
- **Marshal Kaine** (Mixed) — now the vault's actual neutral-pool Rally, rather than an ability
  named Rally that painted grass.

Cards follow the same split. Anvil's text sits on the cheap bodies, because the DC rubric charges
+1 per printed rule and a 75-DEF wall has already spent the budget: Rooted walls (the printed
counterplay to Piercer's Grapnel Yank), a spring-running scout, an acolyte that replaces itself,
an Anvilbearer that traded a DEF tier for a death rattle, and a Sentry Golem whose start-of-turn
burn is the deck's first way to make *holding* threaten anything — reflect only pays if the
opponent chooses to attack. Piercer bought motion and grind instead: a hound that gains a tile
every turn, a charger that arrives charging, a Berserker that keeps +10 ATK per kill, a Reaver
that draws off them, and Silencing Charge, since the deck previously had no answer to Anvil's
only reach or refuel. Cards that stayed vanilla did so on purpose and are allowlisted by test
(`probeDecks.test.ts`), so blanks cannot creep back in: for the big walls the statline is the
card, and for the piercers the keyword is.

DC after the pass: **Anvil 110/110, Piercer 102, Mixed 108** (Mixed shares the pools, so it was
retuned to stay legal) — since re-trimmed to **109 / 106 / 110** under the 2026-08-04 relative
pricing. `fuzz.test.ts` drives all nine ordered probe matchups — the probe decks are not in
`DECKS`, which is how eleven vanilla statlines went unnoticed.

**No A/B was ever run on these lists**, and the promotion has not been A/B'd either.

In game, unit chips read `ATK/DEF`, defending units get a 🛡 and a green ring, and selecting
your own unit shows a stance panel.

Headless: the six paired `defense*` experiments were cut on 2026-08-04 — each flipped a flag that
no longer exists, so both arms became identical. `npm run ab -- defense-gauntlet --single-arm`
replaces them, running the probe decks on the shipping ruleset.

#### Re-read on shuffled decks, 2026-08-01 (32 games/arm per policy)

The `defense` experiment was re-run across all three bot tiers on the same seeds and shuffled
decks, because the older readings had been shaped by a bot that never played its support cards.
The result **splits** — part of the old finding was a bot artifact, part of it was not.

| policy | units killed off → on | ratio | fatigue/deck-out | pass turns Δ | rounds Δ | LP dealt Δ |
|---|---|---|---|---|---|---|
| greedy | 13.2 → 7.1 | 0.54 | 28.1% | +20.8 | +8.3 | −1.2 |
| search | 12.2 → 8.5 | 0.70 | 18.8% | +9.5 | +6.5 | −1.7 |
| expert | 12.4 → 11.2 | **0.90** | **18.8%** | **+3.1** | +4.9 | **+15.2** |

The expert row was **re-measured on the node budget** (2026-08-01, `--rules summoningSickTurns=1`
to hold the old rule) and is now reproducible; greedy and search always were. Every qualitative
claim below survived, but two magnitudes shrank: the original wall-clock sample read pass turns
+5.0, rounds +7.7 and LP +43.9, against +3.1 / +4.9 / +15.2 on re-measurement. The kills ratio
(0.90) and the fatigue rate (18.8%) reproduced exactly.

**Bot artifact:** the combat suppression and the turtling. Kills recover monotonically with bot
quality (0.54 → 0.70 → 0.90) and the extra pass turns collapse from +20.8 to +3.1. Under a bot
that plays its support, defense mode costs about a tenth of the kills, not nearly half — and LP
dealt goes *up* (+15.2), because reflect and pierce damage more than replace the lost overflow.

**Not a bot artifact:** the clock. Fatigue/deck-out plateaus at **18.8%** for both search and
expert and stays statistically significant, and games run longer at *every* tier (+4.9 rounds
even under expert). Defense mode genuinely stretches a game past what a 40-card deck supports; a
better bot does not fix that. This is the part of the original turtle-into-fatigue finding that
stands, and it is a deck-size/clock question rather than a combat one.

Unchanged everywhere: piercer beats anvil ~97% in every arm under every policy — walls have never
been oppressive in any measurement.

#### Summoning sickness is now 0 by default (2026-08-01)

`RULES_DEFAULTS.summoningSickTurns` is **0** — a summoned unit can act the turn it arrives. This
is a design call about tempo and feel, **not** a fix for anything the harness found: the sweep
below is the evidence, and it says removing sickness does not shorten the fatigue games. Set the
knob to 1 to play the older rule.

Consequences worth knowing. The vault sims were transcribed under the 1-turn rule, so those
suites pin it explicitly (`withSummoningSickness()` in `engine/tests/helpers.ts`) and keep
testing what they recorded; `archetypes.test.ts` pins it for the one test that exists to cover
the sickness×dash interaction. **The vault has NOT been updated** — this is a tester default.

Re-measured after the change, shuffled decks, 18 games (3 deck pairs × both seats × 3 seeds):
**search 13 — greedy 5 at sickness 0, search 14 — greedy 4 at sickness 1** — the tier ordering is
intact and the rule change did not move it.

#### Does dropping summoning sickness shorten the fatigue games? No, 2026-08-01

`summoningSickTurns=0` was already known not to *cause* the stall (the `maps` sweep tested that).
This asks the narrower question: given that defense mode stretches games past the 40-card clock,
does letting a summon act immediately buy back enough tempo to matter? The `defense` experiment
was re-run at all three tiers with the rule off, 32 games/arm, same seeds.

| policy | fatigue % (defense on) | rounds Δ (on − off) | rounds, defense on | kills, defense on |
|---|---|---|---|---|
| greedy | 28.1 → **25.0** | +8.3 → +7.1 | 23.4 → 22.5 | 7.1 → 7.4 |
| search | 18.8 → **25.0** | +6.5 → +5.7 | 22.1 → 21.2 | 8.5 → 7.4 |
| expert | 18.8 → **18.8** | +4.9 → +4.3 | 22.8 → 21.7 | 11.2 → 10.9 |

(The expert row is the node-budget re-measurement; both its arms are reproducible.)

**It does not help.** The fatigue rate moves −3.1pp / +6.3pp / **0.0pp** — no consistent
direction, and every one of those deltas is inside its ±95% CI at n=32 (±~14pp on a 20%
proportion). Under the strongest and only fully reproducible tier the rate does not move *at all*:
18.8% either way. The games do get slightly shorter — the defense-mode stretch drops from
+4.9…+8.3 rounds to +4.3…+7.1, roughly a tenth of the added length — but ~4–7 extra rounds is
still ~4–7 extra rounds. Removing summoning sickness is a tempo change; the stall is not a tempo
problem.

**What the fatigue games actually are** (new `endgame.*` telemetry: classifies the last 10 turns
of each game as *fighting* / *deadlock* / *turtle* / *empty*, from attacks, contact distance and
pass rate — see `classifyEndgame` in `scripts/ab.ts`):

| policy | SS | shape of fatigue games | attacks/turn | turns passed | smaller army |
|---|---|---|---|---|---|
| greedy | on | 56% deadlock / 44% turtle | 0.0 | 100% | 3.8 |
| greedy | off | **100% turtle** | 0.0 | 100% | 3.5 |
| search | on | 100% deadlock | 0.0 | 98% | 5.0 |
| search | off | 25% deadlock / **75% turtle** | 0.0 | 91% | 5.0 |
| expert | on | 100% deadlock | 0.1 | 60% | 4.8 |
| expert | off | 100% deadlock | 0.1 | 58% | 5.0 |

**Not one fatigue game in any defense-on arm at any tier was still being fought.** Every one ends
with both players holding a full board (3.5–5 units each — never the `empty` shape, so this is not
attrition running its course), passing 58–100% of their last ten turns, and landing ~0 attacks.
Fatigue here is mutual refusal, not exhaustion. (The single counter-example is the lone
*defense-off* fatigue game, under expert with sickness 0: 0.5 attacks/turn, classified `fighting`
— what a deck-out actually looks like when the game is still live.)

Summoning sickness changes only *where* the refusal happens: with it on the armies stand in
contact and decline to swing (deadlock); with it off, under greedy and search, they do not even
close (turtle — greedy's contact rate over the last ten turns falls 55.6% → 0%, search's
100% → 25%). Expert deadlocks either way. That is the opposite of the hoped-for effect — free
summons let a bot reposition instead of commit, so the game ends further from a fight, not nearer
one. The clock finding from the shuffled re-read stands, and the fix for it is not this rule.

#### The failed-break chip: works where attacks happen, inert where the stall lives (2026-08-01)

`DEFENSE_EXPERIMENT.failChipFrac` (default 0) charges the DEFENDER's owner a fraction of the
attacker's ATK when an attack **fails** to break a wall. The reasoning: attacking an intact wall
is currently a pure loss — no counter-kill, no LP, just a wasted action and reflect damage — so
nobody ever does it. `defense-overflow` had tried to pay for *breaking* a wall and measured a hard
null because a non-piercer never reaches that branch; this pays for the *attempt*, which a stuck
bot can always take, and needs no eval term because the chip shows up as LP in the next position.

Harness: `npm run ab -- defense-failchip | defense-failchip-25` (anvil-vs-piercer gauntlet, both
arms defense-on, so the numbers line up with `defense`).

**First: the premise checked out.** In the control arm, `wallsHeld` and `reflectLP` are **0.00 per
game across all 32 games** — a bot literally never attacks an intact wall. That is the deadlock,
measured directly.

**Second: the lever fires, unlike `overflowFrac`.** At 50%, failed breaks go 0.00 → 1.78/game and
the chip deals 39.9 LP/game. It changes real behaviour.

**Third: it does not touch fatigue.** 25.0% at *every* dose — 0, 25%, 50%, even 100%. Games do
shorten (22.5 → 21.3 → 20.7 rounds) and kills fall (7.4 → 6.1 → 5.6, since a failed attack kills
nothing), but total LP dealt is pinned near 300 at every dose: the chip substitutes for piercer
damage and is partly cancelled by reflect flowing the other way.

**Why, from the per-matchup split — and this is the real finding.** All the fatigue is *one
matchup*: the anvil mirror decks out 8/8 in every arm, while every other pairing is 0/8. And in
that mirror both arms are **byte-identical**: `wallsHeld` 0.00, chip 0.0, **kills 0.0**, 40 rounds,
250 of the 350 LP dealt by fatigue itself. Two wall decks never make contact at all, so there is
no failed attack to pay for and the lever is structurally inert. Where attacks *were* already
happening (anvil vs piercer) it works well: wall assaults 0 → 4.62/game, 112.5 chip LP, games 17%
shorter (16.4 → 13.6 rounds).

**Verdict: not a fix for the stall, but it is not a null either** — it is a real tempo lever for
matchups that already fight, and the first thing to move `wallsHeld` off zero. Held at 0 pending
the expert read and human playtest. The diagnosis it produces is worth more than the lever: **the
wall-mirror stall happens before combat, not in it.** Neither army ever advances, so no combat
rule can reach it; the levers that could are ones that make *holding* cost something, or that
change the draw clock.

#### Defense suite re-run under the 2026-08-02 defaults, with the fatigue clock in hand

Everything below is greedy, 32 games/arm (`--seeds 8`), fog, shuffled, deck-depth terms live —
i.e. the current defaults. Two things changed since the last defense read, so this re-run answers
both "does the record still hold?" and "does the new deck-depth evaluator reach the stall?".

**The mixed-deck turtle is gone, and shuffling is what killed it.** `defense-mixed` now measures
fatigue **0.0% → 0.0%** (rounds +1.7, passes 1.1 → 2.7): defense mode on a realistic deck no
longer decks itself out at all. Attribution, by re-running under each old condition in turn:

| conditions | fatigue (defense ON) |
|---|---|
| current defaults | **0.0%** |
| perfect info | 0.0% |
| perfect info, `--no-shuffle`, `summoningSickTurns=1` (the old world) | **18.8%** * |
| perfect info, `--no-shuffle`, sickness 0 | 25.0% * |
| perfect info, shuffled, `summoningSickTurns=1` | **0.0%** |

So it was neither fog nor summoning sickness — it was **deck shuffling**. In fixed `list` order
both decks drew their walls in the same clumps every game; dealt properly, the mixed deck fights.
That retires the mixed-deck half of the defense stall as an artifact of the pre-2026-08-01 bug.

**The wall mirror is untouched — and the fatigue clock cannot reach it.** `defense` still measures
fatigue 0.0% → 28.1% (*), rounds 15.1 → 23.4, pass turns 1.5 → 21.9. Running the deck-depth terms
against it directly (`defense-fatigue-clock`, both arms defense-ON, evaluator OFF vs ON) is a
clean null: fatigue 31.3% → 28.1%, passes 22.8 → 21.9, endgame turtle 25% → 25%. The per-matchup
split says why in one line:

| matchup | fatigue, clock off | fatigue, clock on | rounds | endgame passing |
|---|---|---|---|---|
| **anvil vs anvil** | **100%** | **100%** | 40.0 → 39.8 | **100% → 100%** |
| anvil vs piercer | 0% / 25% | 12.5% / 0% | 17.4 → 16.4 | 20% → 33% |
| piercer vs piercer | 0% | 0% | 16.5 → 19.0 | 6% → 0% |

**Both deck-depth terms are differential, and a differential term cannot break a symmetric
standoff.** In the wall mirror both bots thin their decks in lockstep at equal LP: the zero-sum
debt cancels exactly, and `desperationPush` reads an urgency of 0 on both sides because neither
player is *behind*. Both are dying to the clock; neither is losing to the opponent.

The obvious follow-up was an **absolute** clock term — `clockPush` (in `evaluate.ts`, default 0),
which scales our own march by how much of our LP the forecast would eat, regardless of the
opponent. It is also a null: `defense-clock-push` moves fatigue 28.1% → 28.1% and passes 21.9 →
21.3, and on the registered decks `clock-push` changes 3 of 294 outcomes. Scoring every legal
action in a frozen mirror shows why no aggression weight of any size can work:

```
frozen wall mirror, empty decks, P0 to move
  Move leader        Δ  0.0     (shuffling in place)
  SetStance u1       Δ -22.5    (leaving defense costs DEF − ATK)
  SetStance u2       Δ  -7.5
  ActivateAbility    Δ  -1.0
clockPush 20 raises the position's score from −5 to 535 — and leaves every Δ bit-identical.
```

A unit in defense stance **may not move**, so an aggression gradient is scaling a term no legal
action can change; and the one action that unlocks the army is a strict loss on the ply it
happens, with the payoff a ply later — outside a one-ply bot's horizon entirely. That is the
sharpened version of the 2026-08-01 diagnosis: not merely *"the stall happens before combat"* but
**the wall mirror is stance-lock, and it is invisible to any evaluator term that prices position
rather than the stance itself.**

What is left, in order of cheapness: price the *option* a defending unit gives up (score the
stance, not the gradient) while the clock runs; make holding cost something in the rules (stance
upkeep, decay or a duration — the lever named a year of experiments ago); or accept it as a
one-ply artifact, since the planner tiers show far less of it. `clockPush` stays in-repo at 0
alongside the other tested-null levers.

**At expert the picture is the same, with one hint.** 16 games/arm (`--seeds 4 --policy expert`;
the mirror games run to the turn cap, so each experiment took ~25 min). `defense` reproduces the
stall — fatigue 0 → **25.0%** (*), rounds 16.1 → 22.4 — so it is not a greedy artifact.
`defense-fatigue-clock` again leaves fatigue exactly where it found it (**18.8% → 18.8%**, rounds
20.7 → 20.8), but unlike greedy the endgame *shape* moves: fighting 50.0% → 68.8%, deadlock 50.0%
→ 31.3%, passes 17.4 → 15.9, and within the fatigue games turns-passed 86.7% → 70.0%. A planner
that can see a ply past the stance flip does spend the clock more actively — it just does not
convert that into a finished game. At n=16 those shifts are 3 games apiece, so treat the direction
as a hint, not a result.

#### Anvil against a field that cannot pierce (2026-08-02)

Every defense reading before this one was anvil-vs-piercer or a mirror — which answers *"can the
deck built to crack walls crack them"* and nothing else. `defense-field` puts anvil against the
registered decks (wildgrowth / tidecaller / hivebrood, which under the flag get the fallback
`def = round(atk/2)` and carry **no Piercing at all**) plus mixed, which has five piercers. Both
arms play the same field; only the flag differs, so anvil's walls are walls in the variant only.

| | greedy, 150/arm | expert, 75/arm |
|---|---|---|
| anvil's ladder position, off → on | 43.3% → **56.7%** (4th → 3rd) | 43.3% → **63.3%** (3rd → 3rd, above mixed) |
| fatigue, off → on | 1.3% → **17.3%** (*) | 0.0% → **10.7%** (*) |
| rounds (mean) | 15.8 → 21.4 | 15.5 → 19.2 |
| pass turns / game | 3.5 → **12.1** | 10.4 → **10.8** |

Anvil's record per opponent, defense off → on (greedy 12 games/cell, expert 6):

| opponent | greedy | expert |
|---|---|---|
| wildgrowth | 8.3% → 41.7% | 0% → 50% |
| tidecaller | 33.3% → 58.3% | 0% → 16.7% |
| hivebrood | 50.0% → 58.3% | 50% → **100%** |
| **mixed** (has Piercing) | 25.0% → 25.0% | 66.7% → **50.0%** |

**Two findings, and they point opposite ways.**

*Walls beating non-piercing decks is real, and it is not a bot artifact* — the lift is **larger**
at expert, not smaller. The one deck whose result against anvil does not improve under the flag
is the one carrying Piercing; mixed is the only opponent that gains. Hivebrood, the swarm, is
worst hit (40.0% → 23.3% overall at expert): chaff cannot break a wall at any width. So the
standing "walls are not oppressive" finding needs its scope stated — it was measured against the
dedicated counter, and against decks with no answer, walls are a large win-rate lever.

*The turtle-into-fatigue half is substantially a greedy artifact.* The planner nearly halves the
fatigue rate (17.3% → 10.7%) and, more tellingly, **does not start idling**: pass turns go 3.5 →
12.1 under greedy but 10.4 → 10.8 under expert. Greedy stalls because it cannot value unlocking a
wall; a planner keeps playing and still ends up in longer games. What survives at expert is real
but smaller — 10.7% is significant, and the anvil mirror is still 2/3.

Caveat: expert cells are 6 games (3 for the mirror), so read the per-opponent rows as directions
and the aggregates as the result. The run took 2h07m for 150 games.

Unchanged in this re-run, matching the record: `defense-piercing` is a near-null (1/32 outcomes
flip, fatigue 28.1% → 31.3%, the only real difference being LP attribution), `defense-overflow` is
still a hard null at greedy (0/32, every metric flat), and `defense-failchip` still fires without
moving fatigue (chip 51.2 LP/game, walls held 0 → 2.22, fatigue 28.1% → 25.0%, ns).

##### ⚠ Expert numbers recorded before 2026-08-01 are not reproducible (fixed)

Found while re-running the above: **the same `--policy expert` command run twice gave different
numbers.** Both `search` and `expert` stopped expanding the beam on a `Date.now()` deadline
(`timeBudgetMs`), so how much of the tree a bot searched depended on machine load. Hard's 4000ms
is never close to binding (~80ms used) and reproduced exactly; Expert's wider beam inside 2000ms
did bind once boards got large. Measured: two identical `defense --seeds 1 --policy expert` runs
produced a **byte-identical control arm** and a variant arm that moved on nearly every metric —
rounds 24.5 vs 25.8, units killed 11.3 vs 12.5, LP dealt 327.3 vs 346.5.

**Fixed the same day: Expert is now budgeted in nodes, not milliseconds** (`EXPERT_NODE_BUDGET`,
`expert.ts`). A node count is a pure function of the position, so the tier plays the same game on
a busy machine as on an idle one, and results are comparable across machines. Sizing came from the
measured distribution of an unbudgeted search (313 searches): nodes median 1,489 / p90 20,970 /
p95 30,886 / max 76,014, wall time median 303ms / p95 1,882ms. The old 2000ms clock was already
clipping the top ~5%; **30,000 nodes clips about the same 5% at about the same latency ceiling**
(~1.7s), so this is a reproducibility fix, not a strength change. Hard keeps its wall clock — its
budget never binds, and interactive play is the case a clock is right for. `ExpertOptions.onPlanStats`
reports `{ nodes, exhausted }` per search if you want to check how often the budget binds.

**Both expert arms above have since been re-run on the node budget**, so every number in this
section is now reproducible. What the wall-clock era got wrong was magnitude, not direction: the
kills ratio (0.90) and the fatigue rate (18.8%) came back identical, while pass turns, rounds and
LP dealt had all been overstated (+5.0/+7.7/+43.9 → +3.1/+4.9/+15.2). That is the expected shape
of the error — a search that sometimes got cut short mid-expansion played slightly looser turns
than it does when the cut always lands in the same place.

## Bot tiers

Three difficulties behind one `Policy` seam, picked per seat in **Game setup → AI settings**:

| Tier | How it thinks |
|---|---|
| **Normal** | `greedy.ts` — one ply. Simulates every legal action, takes the best, stops when nothing beats the position by `actionEpsilon`. |
| **Hard** | `search.ts` — beam search over whole turns, each candidate turn-ending scored *after* simulating the opponent's best reply. |
| **Expert** | `expert.ts` — Hard, plus the two fixes that let a bot actually play support cards. |

### Why Expert exists

Instrumented self-play (2026-08-01) priced every support card in the probe decks and found the
bots skipped them for two independent reasons — and the first one was a bug.

**The decks were never shuffled.** `initGame` takes deck order as given, and every headless
caller passed `[...deck.list]` verbatim; only the GUI shuffled. So every harness game played its
decks in literal list order and `--seeds` varied nothing but the bots' tie-jitter. Cards near the
bottom of a list were never drawn. Fixed: `src/engine/rng.ts` provides the seeded shuffle, the
harness deals from the per-game seed, and `--no-shuffle` reproduces the old behaviour. The effect
on the *same greedy bot*, all else equal: **spells cast per game 0.00 → 4.28, traps fired
0.00 → 2.16.** Every A/B number recorded before this date was measured on fixed draw order and
is not comparable to a post-fix run.

**The evaluator was blind to whole card categories.** Measured eval delta when castable, over 12
shuffled games (max / median):

| card | max | median | why |
|---|---|---|---|
| Draw 1 + GainSP 1 | **0.0** | **0.0** | ±0 cards, ±0 SP — neutral *by construction*, so it can never clear `actionEpsilon` |
| GrantMove 1 | −6.0 | −6.0 | `extraMove` was scored nowhere |
| Immobilize | −6.0 | −6.0 | no mobility-denial term existed |
| +15 ATK buff | +56.7 | −6.0 | good only as buff→swing, and the beam prunes the dip before the payoff |

Expert answers both halves. `EvalWeights` gained five terms — live/dead hand cards, pinned
enemies, trap *placement*, granted movement — **all defaulting to 0, so Normal and Hard score
exactly as they did** and remain valid A/B baselines. A test asserts that. The hand terms grade a
card three ways rather than two: playable-and-can-act, playable-but-pure-cycling, and unplayable.
That third distinction is what prices a cantrip honestly — a card that only replaces itself is
worth less than the card it finds, which is the real reason to cycle.

The search side changes shape, not effort: a **setup quota** reserves beam slots for lines whose
last action was a spell/trap/stance play so they cannot be crowded out, and a **one-ply peek**
ranks those lines by their best follow-up instead of by the dip they cost. (The peek is a
keep-exploring signal only — turn-*endings* are still ranked on their honest score, since an
ending has no follow-up to collect.) Expert also rolls out three turns instead of two, so "set up
now, cash in next turn" is inside its horizon at all. Effort was never the constraint — Hard's
beam uses about 80ms of its 4000ms budget.

Expert's own budget is a **node count** (`EXPERT_NODE_BUDGET`, 30,000 positions per turn) rather
than a wall clock, so its play is reproducible run-to-run and across machines; Hard keeps the
clock, whose only job in an interactive game is bounding how long a human waits. See *Expert
numbers recorded before 2026-08-01 are not reproducible* above for why.

**Measured**, matched effort, shuffled decks. Head-to-head over 16 games across four decks and
both seats: **expert 9.5 — hard 3.5**. Per game over 6 registered-deck games, hard → expert:
spells cast 11.0 → 13.3, cards set 12.3 → 15.3, traps fired 2.3 → 3.2, rounds 16.8 → 20.5.
Forced discards also rise (2.2 → 4.5) — a direct consequence of drawing more, and worth watching.

Headless: `npm run ab -- <experiment> --policy greedy|search|expert`.

### Bots play in fog of war by default (2026-08-02)

Every tier used to plan against **perfect information** — the opponent's hand, deck order and
face-down cards all visible inside its lookahead. That bot never walks into a trap, so traps and
bluffs could not be playtested against it and every trap-carrying deck was being measured as a
worse deck than it is. All three policies now default to `knowledge: 'fog'`, which runs the state
through `sanitize` (opponent hand/deck → `__unknown`, face-downs → inert unknown spells, counts
preserved) before the bot looks at it. The setting is still per seat in **AI settings**, and
perfect info remains the right choice when you want to isolate a stat question from a bluff one.

**Measured**, greedy, 490 games/arm (`npm run ab -- fog --seeds 10`), perfect info vs fog:
traps fired **3.09 → 3.54 per game** (the point of the change), units killed 8.7 → 9.3, direct
leader damage 36.7 → 26.7 with overflow up 233 → 246, forced discards 3.5 → 2.8, fatigue endings
1.8% → 0.8%, rounds 15.0 → 14.7. **17.3% of individual games flip, but the balance picture does
not move**: seat-0 win rate 44.1% → 44.7%, and no deck changes rank (wildgrowth and dragonspire
swap the top two by 0.7pp). So the honest summary is that fog costs the bots roughly nothing in
strength and buys back the whole hidden-information layer of the game.

⚠ **Every A/B number in this README older than 2026-08-02 was measured under perfect info.**
`--knowledge perfect` re-runs any experiment under the old condition; `--knowledge fog` is now
the default, and the run header echoes which one was used.

### Teaching the bots to defend (2026-08-04)

Promoting two-stat combat into the core rules left the mechanic technically live and practically
dead: **0.5 stances per game, 0.0 walls held** across a full greedy ladder. The evaluator scored a
defending body as `unitDef × effectiveDef` in place of `unitAtk × effectiveAtk` — a straight stat
swap, so a unit defended only when its DEF beat its ATK. Since the DEF content pass deliberately
prints most cards *under* the `round(atk/2)` line, that condition is almost never true.

The stat swap was not wrong, it was incomplete. It priced none of what the stance actually buys:

- **`wallDenyFrac` (0.5, near par)** — per point of **overflow the body denies**. Combat overflow
  means an out-statted body in attack stance does not merely die, it pays the margin off its own
  leader's pool; a broken wall pays **nothing** unless the attacker Pierces. Against a threat that
  out-stats it, defending converts a bleeding loss into a clean one. Priced high because it is the
  near-certain half: if an adjacent enemy out-stats a body, the opponent takes that attack.
- **`wallReflectFrac` (0.1, well under `threatChipFrac`)** — per point of **reflect** a held wall
  would deal. Priced low on purpose: reflect is damage the opponent has to *volunteer* for, so its
  honest value is deterrence, not damage.

Both read the *worst* attack the body could actually face — orth-adjacent enemies plus any Ranged
enemy already covering the tile, with the real flank bonus via the engine's own `flankAllies`. Both
are own-side only; `evaluate` is `sideScore(me) − sideScore(opp)`, so an enemy wall already scores
against us through the subtraction and signing by ownership would double-count.

Enemy leaders are threats like any other since the 2026-08-04 ruling, but they contribute to
**reflect only, never deny**: leader-vs-unit combat is binary and spills no LP either way, so there
is no overflow for the stance to deny. The two halves are tracked separately for exactly this
reason — `worstAtk` over every threat (what the wall must survive) and `worstDeny` over non-leader,
non-piercing threats (what the stance actually saves).

**A/B (`npm run ab -- stance`, 1024 greedy games, 8 seeds, all matchups):**

| metric | stance blind | terms on | Δ |
|---|---|---|---|
| stances taken / game | 0.6 | **9.4** | +8.8 |
| walls broken / game | 0.1 | 5.2 | +5.1 |
| walls **held** / game | 0.0 | **0.0** | +0.0 |
| LP from overflow | 244.0 | 187.9 | **−56.1** |
| LP from leader combat | 32.0 | 81.1 | **+49.1** |
| LP dealt total | 289.3 | 290.5 | +1.2 |
| rounds (mean) | 15.2 | 18.9 | +3.6 |
| fatigue / deck-out % | 0.6% | 5.9% | +5.3% \* |
| outcomes changed | — | — | 21.9% |

The mechanism is visible in the LP columns: the bots deny each other ~55 LP of overflow and then
have to go and *take* it off the leader instead, for the same total damage delivered more
deliberately. The cost is length — games run 23% longer and deck-out rises to 5.3% (still well
under the 13.1% that got the 30/2 deck size declined).

Re-run after the leader ruling landed, and it moved almost nothing (9.3 → 9.4 stances, 5.3% → 5.9%
fatigue) — for the same reason `walls held` is 0.0. Nothing in the pool can hold a wall, so the
case where a leader is turned away by one barely arises yet. The ruling is a coherence fix whose
effect is waiting on content.

**Walls held stays at 0.0, and that is a content fact, not an eval one.** Nothing in the current
pool can hold: the stance is being used purely as overflow denial, because most printed DEF sits
below ATK. If walls that actually *hold* are wanted, the dial is printing DEF above the line, not
the evaluator.

**Dose (`npm run ab -- stance-dose`):** halving `wallDenyFrac` to 0.25 gives 8.2 stances/game and
3.7% fatigue against the full dose's 9.3 and 5.3% — every delta within noise. As with
`threatChipFrac`, the term's **presence** matters far more than its size, so the fatigue rise is
inherent to the behaviour rather than to the weight. 0.5 stands as the principled "near par" value.

### Deck depth: the bots can now see the fatigue clock (2026-08-02)

Fatigue was invisible to every tier. LP already lost to it showed up as LP, but nothing in
`evaluate` looked at how many cards were *left*, so a bot walked into an escalating 10/20/30 LP
burn with no warning and — worse — kept passing turns while it burned, because passing is free
to an evaluator that cannot see the clock. Three weights (`evaluate.ts`), live for all three
tiers:

| weight | default | what it does |
|---|---|---|
| `fatigueFrac` | 0.5 | prices `projectedFatigueLp` — LP the side is forecast to lose to fatigue — at half the live per-LP weight, for **both** sides, so my thinning deck is a debt and theirs is an asset |
| `fatigueHorizon` | 10 | own turns of lookahead. Deeper than this, the terms are exactly 0 |
| `desperationPush` | 1 | scales *our own* march (up to ×2) as we fall behind on **effective LP** — real LP minus forecast fatigue |

The forecast is the draw rule and nothing else: one card per own turn, the n-th missed draw
costs `fatigueStep × n`, capped at the LP actually left. It ignores extra draws from card
effects — they shorten the deck, and the evaluator sees the shorter deck a turn later.

`desperationPush` is the half that changes play, and it is deliberately asymmetric: it scales
`leaderThreat` only (never `leaderExposure`), and it applies *after* `leaderThreatCap`, because
being about to lose the race is exactly the case where the march should outbid terrain camping.
Urgency is measured against the enemy's remaining pool, not the starting total — 40 LP down
against 180 is a game to play out, 40 down against 45 is a game to finish now.

**Measured**, greedy, shuffled decks, 490 games/arm (`npm run ab -- fatigue-clock --seeds 10`),
control = the pre-2026-08-02 evaluator:

| | control | on | |
|---|---|---|---|
| seat-0 win rate | 46.5% | 44.1% | within CI |
| rounds (mean) | 15.3 | 15.0 | |
| pass turns / game | 3.5 | 3.1 | |
| LP lost to fatigue | 2.3 | 1.4 | |
| stalls | 0 | 0 | |

Standard 40-card play barely reaches the horizon — only 1.4% of those games ended on fatigue —
so the honest summary is **neutral-to-slightly-sharper, and free**. The per-deck ladder moves
within a few points and no deck changes rank. The regime the terms exist for needs a magnifying
glass: `fatigue-clock-short` replays the same A/B on 18-card decks, where two thirds of games
end on the clock (a probe condition only — **40/3 stands**, per the 2026-07-20 decision):

| 18-card decks | control | on |
|---|---|---|
| LP lost to fatigue / game | 99.8 | **76.9** |
| games ending on fatigue | 66.7% | 63.3% |
| rounds (median) | 14 | 13 |
| pass turns / game | 3.2 | **2.1** |
| endgame turns passed | 8.2% | 5.5% |
| endgame turtle / empty | 1.2% / 2.2% | 0.2% / 0.8% |
| units killed / game | 6.1 | 6.6 |
| SP waste | 62.0% | 58.0% |

That is the whole intent: a bot on the clock stops idling and forces the kill. Seat balance and
stall rate are unmoved in both regimes.

A third run isolates the halves (`fatigue-clock-static`, forecast on / desperation off): it
changes **2 of 490 outcomes**. Within a turn the forecast is near-constant — deck length only
moves when a card is drawn — so it does almost no work by itself; its job is feeding the
effective-LP comparison that `desperationPush` reads. Keep them together or not at all.

These are `EvalWeights`, not RULES, so both arms of the new experiments run identical rules and
differ only in what the bots see. That is a third experiment shape for the harness (alongside
*flag* and *decks*), and `Arm.weights` is what carries it.

### Recorded A/B findings needed re-running (opened and closed 2026-08-01)

Deck shuffling was added on 2026-08-01. **Every A/B result recorded before that date was
measured with both decks in literal `list` order** — `--seeds` varied the bots' tie-jitter and
nothing else, so games were never independent samples, the ±95% CIs describe one fixed draw
sequence, and cards near the bottom of a list were never drawn at all. Findings from those runs
are not wrong so much as *unverified*: they may survive re-measurement, but none of them should
be cited until they have been.

#### CLEARED — all re-run at expert, 2026-08-01

Every entry has now been re-measured on shuffled decks with the reproducible (node-budgeted)
expert bot. Sample sizes are smaller than the greedy originals because expert costs ~46s/game;
where a delta is inside its ±95% CI the table says so.

| Experiment | Stale claim | Verdict at expert |
|---|---|---|
| `deck-30-2` | fatigue 0.3 → 7.7%, uneven per-deck shift | **Survives, amplified.** 1.0 → 16.3% (*sig, 98/arm). The basis for declining 30/2 is stronger, not weaker. Secondary claims mostly do NOT reproduce — rounds flat, kills/summons barely move, and "direct leader damage rises" *reverses* (24.9 → 17.8). Per-deck shift reproduces in kind, not detail (gravemarch −14.3pp, tidecaller +10.7pp). |
| `guard` | intercepts ≈ 0/game, "pure deterrence" | **Not re-runnable — struck.** 0/98 outcomes changed, every metric +0.0, because **no registered card carries the `Guard` keyword**. The committed experiment toggles a flag nothing can trigger. The historical numbers came from uncommitted scratch tooling that granted the keyword onto deck bodies. Needs dedicated Guard-statted cards (already the recommended adoption path) before it can be measured at all. |
| `defense` | turtle-into-fatigue; piercer ≫ anvil | **Splits** — see the shuffled re-read above. |
| `defense-mixed` | fatigue 0 → 12.5% under search | **Half survives.** Variant fatigue reproduces *exactly* at 12.5%, but control is 3.1%, so the delta (+9.4pp) is **not significant** at n=32. Defense mode is much milder on a realistic mixed deck: rounds +1.3 (vs +4.9 on pure walls), kills ratio 0.86. |
| `defense-piercing` | buff vs atk is a hard null | **Softens to a near-null.** No longer byte-identical (3/32 flip) but every outcome metric is flat: fatigue identical 18.8%, rounds +0.7, kills +0.3. LP attribution splits exactly as recorded (overflow +41.1, effect −31.1). Still undecidable from self-play — pick on feel. |
| `defense-overflow` | 0.0 delta everywhere; branch never fires | **Reversed.** 4/32 outcomes changed — and since the arms differ only in `overflowFrac` and expert is deterministic, that is proof the branch *does* fire under a bot that plays support. Direction favourable but not significant: fatigue 12.5 → 3.1%. The old "hard null" was a property of greedy and search, not of the lever. |
| `maps` | Dragonspire 39.3pp spread, Gravemarch −20pp on Sanctum | **Partly survives, weaker.** Max spread is 21.4pp, not 39.3pp, and Dragonspire's mountain preference does not clearly reproduce. Gravemarch on Sanctum reproduces almost exactly (42.9 → 21.4%, −21.5pp vs the recorded −20pp). Chokepoint maps still slow games: rounds 14.3 open → 16.9–17.4 walled, fatigue 0% open → 2.0–4.1% walled. **Caveat: 1 seed = 14 games per deck×map cell, so every value is a multiple of 7.1pp.** |
| `maps --rules summoningSickTurns=0` | sickness is not what drives the stall | **Superseded** — sickness 0 is now the default, so the plain `maps` row above *is* the sickness-off measurement. |

`--no-shuffle` reproduces the old behaviour if you want to diff a specific result against its
original run rather than just replacing it. The `defense` read has been re-run (see *Bot tiers*);
the rest are outstanding.

The same caveat now applies to **bot knowledge**: everything in that table was measured with
perfect-information bots, the default until 2026-08-02. Fog is balance-neutral in aggregate
(see *Bots play in fog of war by default*), so these verdicts are unlikely to invert — but a
trap-sensitive one re-measured under fog should be re-run with `--knowledge perfect` alongside if
it is being compared to its recorded value.

### Harness speedups + retired experiments (2026-08-03)

The first overnight campaign ran 14 experiments sequentially and took **9.1 hours**, 77% of it in
two planning-tier runs, on **one of this machine's twelve cores**. Measured fix — four concurrent
runs finish in 1:04 against 4:03 sequential (**3.8× at 407% CPU**), so the work is cleanly parallel.

New flags:

| Flag | What it buys |
|---|---|
| `--seed-offset N` | Shards **one** experiment across cores (`--seeds 15 --seed-offset 30`). A single run is one process on one core, so this is the only way to speed up a big one. Also the honest way to cross-check a ladder: two experiments sharing a baseline control arm **at the same seeds produce identical games**. |
| `--focus <deckId>` | Only matchups involving that deck — 14 of 64 ordered pairs at 8 decks, and the pair count grows quadratically with the pool. A focused Red Mark ladder is **59s vs 23min**. |
| `--single-arm` | Skips the variant run and reports control against itself. For `ladder`, where both arms are the shipping baseline, the variant is pure waste. |
| `--deep` | Opts **out** of the new default: search/expert now use cheaper planning knobs (beam 4 / depth 5 / reply 3 / rollout 1 / 800ms, expert node budget 6000). Measured **2.9× faster with an identical result**, and it matches how every planning-tier number on record was actually taken. Use `--deep` when the *question* is bot strength. |

New experiment **`ladder`** — no rules change, just the shipping baseline. Deck work needs a
per-deck ladder and there was no first-class way to get one; ladders were being read off whatever
experiment's control arm happened to be baseline, which is why a vacuous `guard` run stayed in the
campaign for so long. Use it with `--single-arm`.

New command **`npm run diagnose -- <deckId>`** — a ladder says *that* a deck loses; this says *why*.
It compares what the deck fields against the field average and then measures whether its signature
actually fires in real games. On The Red Mark it flags mean ATK, top ATK, ATK-per-DC and level-5+
count as LOW, and reports that its archers have a legal shot only **24%** of turns.

New command **`npm run impact`** (2026-08-16) — a ladder says *that* a deck loses and `diagnose`
says *why the deck* loses; this says whether an individual **card** does anything at all. It runs
self-play, slices each action's new log lines, segments them by resolution marker and tallies what
followed: kills, LP, statuses, counters, displacements, paints, draws, tokens, negates — plus a
`NIL` column counting resolutions after which *nothing observable happened*.

```
npm run impact                          # 648 games, greedy, arena
npm run impact -- --policy search       # cross-check: greedy under-fires set cards (see below)
npm run impact -- --focus redmark --seeds 4
```

It also prints two pool-wide tables that are worth more than the per-card rows:

- **the damage threshold** — of every N-damage hit, how many actually killed;
- **an effective-ATK census** of live bodies, sampled each turn handover — the median live body is
  a **40**;
- **the effective ATK of what damage actually hit**, which is the number that matters and is *not*
  the same thing. ⚠ Damage victims measured **mean 44.1 / median 45** against the board's 39.7 / 40,
  because a zone trap catches whoever walked into your half and a punish catches whoever chose to
  attack — both self-select for the big bodies. Pricing a damage number against the board census
  is optimistic by about 5 ATK; that mistake is why raising the pool's 20-damage tier to 30 moved
  the measured kill rate only 10% → 12% when the board census predicted 37%.

What it found on the pass that motivated it: the nine 20-damage cards killed something **4–10%**
of the time, `bodkinVolley` had **never resolved once in 729 games**, and `dragonfire`'s 221
resolutions produced 5,525 LP and **zero** unit kills (every copy went at a leader's face). See
`DAMAGE_FLOOR` in `deckDef.ts`.

⚠ **Read the `res` column with the eval in mind.** `evaluate()` scores `setCard` (11) above
`handCard` (10), so setting any card is a free +1 while casting a net-zero spell is ≤ 0 — a
one-ply bot declines anything worth under about one eval point. "Set 252, resolved 4" means the
effect is *small*, not that a human could not use it. Always cross-check with `--policy search`.

**Retired (cut 2026-08-03)** — verdicts kept in a comment block at the top of `buildExperiments`,
so they are not re-added blind: `guard` (⚠ **vacuous** — no card in any deck carries the keyword,
so the flag has nothing to act on), `deck-30-2`, `fog`, `fatigue-clock`, `fatigue-clock-static`,
`clock-push` (all decided/adopted), `defense-piercing` (unanswerable by self-play),
`defense-overflow` (falsified twice), `defense-failchip` and `-25` (near-null).

### Sweeping maps in the harness

`npm run ab` defaults to Arena. `--board <id|id,id|all>` runs any experiment across other maps
and adds two tables to the report: **per-map outcomes** (seat-0 win rate, fatigue, rounds, both
arms) and a **deck × map win-rate matrix** with a `SPREAD` row — how far each deck's win rate
moves across the pool, i.e. its map sensitivity. The `maps` experiment is the dedicated survey:
Arena as control vs the whole pool as variant, baseline rules and the full deck registry, so the
only difference between arms is the ground.

`--knowledge fog|perfect` sets what both arms' bots may see (default fog since 2026-08-02); the
`fog` experiment is the dedicated arm-vs-arm comparison of the two.

`--rules key=value,key=value` applies `RULES` overrides to **both** arms for the whole run — a
background condition rather than the variable under test, so any experiment can be re-asked
under a different ruleset (e.g. `--rules summoningSickTurns=0` to see whether a result survives
when units can attack the turn they land). The override is echoed in the report header.

### Experimental decks

The deck viewer lists the probe decks below the registered ones, in the same format, under an
**Experimental decks** divider. Cards carrying an explicit DEF show it there whether or not
defense mode is currently on. They stay out of `DECKS` — they only make sense with the flag on —
but `content.test.ts` holds them to the same deckbuild rules as the registered pool, which is
the check that was missing when they drifted illegal.

## Architecture

```
src/engine/           pure TS, no React/DOM. applyAction(state, action) -> state
src/engine/rules.ts   RULES: the tunable constants (LP, SP curve, caps, fatigue, flanking),
                      mutable + global so the setup screen and the A/B harness can sweep them
src/engine/content/boards.ts
                      the built-in map pool as ASCII pictures + the procedural map generator
src/engine/content/   cards as data: POC decks (poc.ts) + test-only sim decks (simDecks.ts)
src/engine/tests/     sim1..sim9 + stats/combat/purity/fuzz
src/ai/               bot opponents behind a Policy seam: greedy one-ply ("Normal"),
                      beam-search whole-turn planner with opponent-reply rollouts ("Hard"),
                      and a support-card-aware planner ("Expert", src/ai/expert.ts);
                      per-seat difficulty/behavior/knowledge configured in game setup
src/engine/rng.ts     seeded PRNG + deck shuffle, shared by the policies and the harness
src/ui/               thin React layer over legalActions/applyAction
src/ui/experiments.ts the tester's control surface: one serializable config covering the
                      prototype flags + RULES, pushed into the engine once per game start
```

`effectiveAtk` is a pure compute-on-read function (base + auras + statuses + terrain), so "stats are derived, never stored / never cache across a mutation" (Rules Spec §6) holds by construction. Engine purity is enforced by a test.

## ⟨OPEN⟩ working rulings (each marked `TODO(open)` in code)

- Win = LP ≤ 0 only; no checkmate, no simultaneous-lethal rule.
- Ascension/Transform is **permanent**; the unit keeps its name/cardId (fusion recipes still match).
- Ranged = orthogonally adjacent without entering; binary resolution, defender strikeback applies, no advance-on-kill.
- `TilesMovedThrough` on a 1-tile move = the destination tile (sim-1 ruling).
- "per friendly Forest tile" counts scoped to the unit's surrounding 8, incl. its own tile (sim-1 ruling).
- Card conditions ("ATK ≤ 20") read **effective** ATK — Grave Tyrant fizzles vs a terrain-lifted body.
- Springs: occupying at relight = immediate capture; each spring relights 3 rounds after **its own** capture (vault also says "synchronized" — unresolved).
- P1 does draw on turn 1; sets per turn unlimited (bounded by the 5-slot cap); leader move/summon order free.
- Located "at/adjacent" reach = Chebyshev ≤ 1 from where the spell resolves (leader for face-up casts, the set card's tile for flips).
- `Damage(X)` vs a one-hit unit = destroyed iff X ≥ its current effective ATK; vs a leader = LP loss.
- ~~Raise takes the most recent matching card in the graveyard~~ — **resolved 2026-08-08**: an action can now name one (`Action.chosenCards`). Unchosen raises still take the most recent match.
- Fusion materials go to the graveyard; token overflow places as many as fit.
- Token cap: ≤ 5 tokens per player, overflow spawns fizzle (supersedes the vault's "tokens bounded spatially only" — Hivebrood's token engine flooded the board in ~2 turns).
- Leader attacks leader: chip lands as usual; a strikeback that would destroy a unit attacker (def ≥ atk) instead chips the attacking leader's LP for the strikeback amount (leaders are never destroyed as pieces).
- Trigger-fired `Destroy` (a mine/trap catching a leader) fizzles against leaders; player-cast Destroy still can't target them.
- **Economy (2026-07-17 pass, supersedes vault Economy & SP as written):** SP ladder flattened to 4/7/8 (cap 8, was 4/7/10/12); spells cost SP at activation (paid before traps chain, lost like the card if negated; mines exempt — they detonate off enemy contact, not an activation); top-end units carry `sp` summon costs above level (a bomb = 8 = a whole cap turn).
- **Flanking (2026-07-17, adopted after A/B trials):** a unit attacking a unit gains +5 effective ATK per other friendly **non-token** unit adjacent to the defender, max +10. Leaders neither grant nor receive it; tokens never count as flankers (token-eligible flanking handed the swarm archetype the meta in trials). Ranged attacks flank too. Tests in `flank.test.ts`.
- **Combat overflow (2026-07-18, adopted after A/B trials):** unit-vs-unit combat is no longer purely binary — the winner's effective-ATK margin (`aTot − dEff`, flank included) spills to the **losing unit's owner's** LP pool. Applies to melee and ranged; a tie is still mutual destruction (0 margin, no spill). Leader combat is unchanged (still attritional/binary). A/B (245 games/arm, greedy self-play): stalls 11%→0% (100% decisive), avg game 24.9→16.1 rounds, avg LP dealt 270→318 — directly kills the kite-stall failure mode at the combat layer. Resolves in `resolveCombat` (`engine.ts`).
- **Status duration (2026-08-02, fixes a defect vs the vault):** `turnsLeft: N` means the status is live for exactly **N of the victim's own turns**. The tick drops an already-spent status at the start of the victim's turn rather than decrementing-then-dropping-at-zero — the old order retired it *before* the victim ever acted, so every N only cost N−1 activations, against Non-Unit Cards' locked "'immobilized for 2 turns' always costs the victim exactly 2 of its own activations". All five stun cards were half-strength until this landed.
- **`Stunned` (renamed from `Immobilized`, 2026-08-02) blocks every action, not just movement** — moving, attacking, Ranged attacks and stance changes. It previously guarded only the move path, so a pinned Ranged unit shot and killed at full effect. Combined with the duration fix, the five stun cards went from "1 turn, Ranged ignores it" to "2 turns, total lockdown" in one step; treat any earlier A/B number involving them as stale.
- **Forced movement springs zone traps (2026-08-02):** a push or pull into a trap's 9-tile zone sets it off exactly as walking in would. The displacement has already resolved, so a `negate` trap has nothing left to cancel. `OnMove` rules still do **not** fire — the unit did not choose to move. Note displacement can never land *on* a mine: a set card occupies its tile, so a push halts at the last empty tile. This also required `fireTraps` to start checking that the moved unit is an **enemy of the trap's owner** — historically redundant, because on the ordinary move path the mover is always the active player's unit.
- **The denial axis (2026-08-02):** `Snared` (no move), `Disarmed` (no attack), `Stunned` (neither), **and anything that cannot attack cannot strike back** — a Disarmed or Stunned defender loses ties and a losing attacker bounces off harmlessly, `Suppressed` (rules + keywords inert). Split this way because move-is-attack makes movement and offence the whole action surface, and each point on the axis has a different positional answer. Enforcement is centralised: `cannotMove` / `cannotAttack` in `status.ts` back every guard, `hasKeyword` is the single place keyword possession is decided, and `unitRules` is the single place a unit's own triggers are read.
- **Sigils (2026-08-02):** marked ground applying a timed status on **entry** — see the Sigils section above. A tile marker rather than a terrain, cleared by painting, and entry-only so movement denial can never soft-lock its victim.
- **Leaders are immune to crowd control (2026-08-02):** denial statuses (`Stunned` / `Snared` / `Disarmed` / `Suppressed`) never attach to a leader, from any source. Enforced in `applyStatus`, so sigils, spells and traps all obey it. Sigils bill leaders `RULES.sigilLeaderLp` instead. `AtkMod`/`DefMod` are stat changes rather than CC and still apply.
- **Ranged is exact-range (2026-08-03):** a `Ranged` card fires at exactly `range` orthogonal tiles (default 1), never nearer; Walls block the line but units do not; and **retaliation requires reach** — a defender only strikes back if it could itself attack the attacker's tile, so a shot from beyond melee goes unanswered unless the target is a matching-range shooter. This resolves the vault's parked "does Ranged sidestep strikeback?" thread: it does, but only from outside melee, and for a stated reason rather than as a keyword perk. Range 1 is byte-for-byte the old behaviour, including its error message.

## Discrepancies surfaced (engine ≠ sim narrative)

The big one: **do "type-on-favored-terrain +10" leader passives stack with the ±10 terrain mod?**
Rules Spec §6 as written says yes (auras and terrainMod are separate sums); the sim notes' arithmetic
consistently counted a single +10 (sim-2 "Duneshambler 50", sim-6 "Colossus 85 on Mountain",
sim-8 "Hexblade 70 on Shadow"). The engine follows the Rules Spec (RAW). Every sim **outcome**
(who dies, LP deltas, winners) still reproduces — sim-6's Apex-vs-Colossus duel and sim-7's
Leviathan-connects-for-80 match exactly — only some standing-ATK quotes differ. Flagged as
`DISCREPANCY` comments in `sim2/3/6/8.test.ts`. Worth a vault ruling either way.

## Scope walls (per the POC spec)

No networking, accounts, Blitz, Replace, draft, artifacts, hazard tiles.
(The original walls also excluded AI, deckbuilder, persistence, and Deck Cost — those
have since been crossed: `src/ai/`, the deck/board builders with localStorage
persistence, and the proposed `dc` numbers in `content/decks/`.)
