// Status predicates, split out of engine.ts so the low-level modules (board, stats) can read a
// unit's denial state without importing the engine and creating a cycle. Everything here is pure
// over a single Unit — no GameState, no board.

import type { Keyword, TimedStatus, Unit } from './types';

/**
 * Statuses that take a unit's turn away rather than adjusting a number.
 *
 * The action surface is small enough to name exactly: a unit can MOVE and it can ATTACK, and
 * because move-is-attack those overlap for melee. So the denial vocabulary is three points on
 * one axis rather than three unrelated effects:
 *
 * | status       | move | attack | its natural counter          |
 * |--------------|------|--------|------------------------------|
 * | `Snared`     |  ✗   |   ✓*   | being `Ranged` (*melee still can't reach) |
 * | `Disarmed`   |  ✓   |   ✗    | retreating                   |
 * | `Stunned`    |  ✗   |   ✗    | — (the premium, priced as such) |
 * | `Suppressed` |  ✓   |   ✓    | — (denies TEXT, not actions) |
 *
 * `Suppressed` is in this set because leaders must be immune to it for the same reason they are
 * immune to the others, not because it denies an action.
 *
 * `AtkMod`/`DefMod` are deliberately NOT here: shrinking a stat is not crowd control, and a
 * leader's ATK is load-bearing as its anti-swarm rating.
 */
export const DENIAL_STATUSES: ReadonlySet<TimedStatus['kind']> =
  new Set<TimedStatus['kind']>(['Stunned', 'Snared', 'Disarmed', 'Suppressed']);

/**
 * Statuses that are a TAG rather than a quantity: they are either on a unit or not, so applying
 * one twice refreshes it instead of stacking a second copy. `AtkMod`/`DefMod` are deliberately
 * absent — two different buff cards SHOULD sum.
 *
 * `Marked` is here but NOT in DENIAL_STATUSES: it denies nothing on its own, it only designates a
 * target for cards that read it. Leaders are therefore markable, which the archetype depends on.
 */
export const TAG_STATUSES: ReadonlySet<TimedStatus['kind']> =
  new Set<TimedStatus['kind']>([...DENIAL_STATUSES, 'Marked']);

const has = (u: Unit, kind: TimedStatus['kind']): boolean => u.statuses.some((st) => st.kind === kind);

/** Full lockdown: neither move nor attack. */
export function isStunned(u: Unit): boolean {
  return has(u, 'Stunned');
}

/** Movement denied; a `Ranged` unit can still shoot from where it stands. */
export function isSnared(u: Unit): boolean {
  return has(u, 'Snared');
}

/** Offence denied; the unit may still reposition or retreat. */
export function isDisarmed(u: Unit): boolean {
  return has(u, 'Disarmed');
}

/** Card rules do not fire and keywords are inactive. Denies TEXT, not actions. */
export function isSuppressed(u: Unit): boolean {
  return has(u, 'Suppressed');
}

/** Movement denial, from any source. Because move-is-attack this also stops melee attacks. */
export function cannotMove(u: Unit): boolean {
  return isStunned(u) || isSnared(u);
}

/** Offence denial, from any source — melee initiation and Ranged attacks alike. */
export function cannotAttack(u: Unit): boolean {
  return isStunned(u) || isDisarmed(u);
}

/**
 * Can this unit hurt something that attacks it?
 *
 * **Striking back is attacking**, so this is exactly `cannotAttack` — a unit denied its offence
 * is denied it whether or not it chose the fight. Kept as its own name because it states the
 * combat-side consequence, and because unit combat has no discrete strikeback step to switch
 * off: it is a single effective-ATK comparison, and the defender "counters" purely by winning
 * it. So the phrase had to be *given* a meaning, and the meaning is **a helpless defender never
 * harms its attacker, and loses ties** — the attacker is never destroyed, never takes overflow,
 * and an equal-ATK trade stops being mutual destruction.
 *
 * Consequence for the axis: `Disarmed` and `Stunned` are both safe to attack, while `Snared`
 * and `Suppressed` still defend at full strength. That is not a flat ladder but a trade-off —
 * `Snared` pins a body in place yet leaves it dangerous to touch, `Disarmed` makes it harmless
 * to touch yet lets it run. `Stunned` is the premium precisely because it is both.
 */
export function cannotStrikeBack(u: Unit): boolean {
  return cannotAttack(u);
}

/**
 * The one place keyword possession is decided. A `Suppressed` unit has none of its printed
 * keywords, so Frenzy stops adding ATK, Anchored stops refusing displacement, Guard stops
 * intercepting, and Wallwalk stops opening walls — all by continuous re-evaluation, with no
 * mutation of `u.keywords` (the printed list stays intact so the status can expire cleanly).
 *
 * Note a `WallPass` STATUS is not a keyword and therefore survives suppression: it was granted
 * by another card, and suppression silences this unit's own text.
 */
export function hasKeyword(u: Unit, k: Keyword): boolean {
  // A GRANTED keyword survives suppression, on exactly the reasoning already recorded above for
  // `WallPass`: it is another card's text, and `Suppressed` silences this unit's OWN text. The
  // grant is checked first so it also restores a keyword the unit's printed list has but
  // suppression is currently denying.
  if (u.statuses.some((st) => st.kind === 'Granted' && st.keyword === k)) return true;
  return !isSuppressed(u) && u.keywords.includes(k);
}
