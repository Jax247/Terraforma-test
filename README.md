# Terraforma POC

Throwaway hotseat proof-of-concept for the Terraforma design vault. Two goals:

1. **Play it** — two players, one screen, Wildgrowth (Briar) vs Gravemarch (Oskar) on the sim map.
2. **Prove the rules** — the nine vault simulations are encoded as Vitest suites; the engine is correct iff replaying them yields the states the notes describe.

## Run

```sh
npm install
npm run dev        # hotseat game at the printed localhost URL
npm test           # the nine sim suites + stats/combat/purity/fuzz (89 tests)
npm run typecheck
```

## Play (hotseat)

Click a unit → highlighted tiles are its legal moves; moving onto an enemy is an attack, onto a registered fusion partner is a fuse. Hand cards have `summon` / `cast` / `set` buttons; target-bearing spells and abilities then ask you to click target tiles. Units show **live effective ATK** (recomputed continuously — watch it change as terrain is painted under them). 💧 = active spring, 🕳️ = dormant. `End turn` passes the seat.

## Architecture

```
src/engine/           pure TS, no React/DOM. applyAction(state, action) -> state
src/engine/content/   cards as data: POC decks (poc.ts) + test-only sim decks (simDecks.ts)
src/engine/tests/     sim1..sim9 + stats/combat/purity/fuzz
src/ui/               thin React layer over legalActions/applyAction
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
- Fusion materials go to the graveyard; token overflow places as many as fit.

## Discrepancies surfaced (engine ≠ sim narrative)

The big one: **do "type-on-favored-terrain +10" leader passives stack with the ±10 terrain mod?**
Rules Spec §6 as written says yes (auras and terrainMod are separate sums); the sim notes' arithmetic
consistently counted a single +10 (sim-2 "Duneshambler 50", sim-6 "Colossus 85 on Mountain",
sim-8 "Hexblade 70 on Shadow"). The engine follows the Rules Spec (RAW). Every sim **outcome**
(who dies, LP deltas, winners) still reproduces — sim-6's Apex-vs-Colossus duel and sim-7's
Leviathan-connects-for-80 match exactly — only some standing-ATK quotes differ. Flagged as
`DISCREPANCY` comments in `sim2/3/6/8.test.ts`. Worth a vault ruling either way.

## Scope walls (per the POC spec)

No networking, accounts, deckbuilder, persistence, AI, Deck Cost, Blitz, Replace, draft,
artifacts, hazard tiles. UI ships only Wildgrowth vs Gravemarch; the other six sim decks
exist as test fixtures in `simDecks.ts`.
