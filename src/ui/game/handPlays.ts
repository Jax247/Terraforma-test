import { cardSpCost, isMineOnly, setSpCost, unitSpCost } from '../../engine';
import type { CardDef } from '../../engine';

/**
 * The plays a card in hand offers, and why each one is or isn't available.
 *
 * Two surfaces render this now — the hand's own button row, and the "Play a card…" page of
 * the board's action menu — and a card that is greyed out in one must be greyed out in the
 * other, for the same stated reason. Deriving both from here is what guarantees that; the
 * wording used to live inline in `Hand.tsx` and had nowhere else to be reached from.
 *
 * ⚠ `enabled` is read from `playable`, which comes off the engine's own bound enumeration —
 * never re-checked here. The costs below only pick the WORDING of a refusal; they are not a
 * second opinion on whether the play is legal. See GameView's `playable`.
 */
export type HandPlayKind = 'summon' | 'cast' | 'set' | 'setDef';

export interface HandPlay {
  kind: HandPlayKind;
  /** Lower-case verb for the hand's compact buttons. */
  short: string;
  /** Sentence-case label for the action menu, which has room for the full phrase. */
  long: string;
  /** SP this specific play charges — NOT the number printed on the card; see `setSpCost`. */
  cost: number;
  enabled: boolean;
  /** What it does, or why it can't — the same sentence on both surfaces. */
  title: string;
}

/** Card ids the engine will currently accept each play for. */
export interface Playable {
  summon: ReadonlySet<string>;
  cast: ReadonlySet<string>;
  set: ReadonlySet<string>;
}

export function handPlays(cardId: string, def: CardDef, sp: number, playable: Playable): HandPlay[] {
  // Summoning and casting charge the printed number; setting has its own price — a trap and a
  // mine prepay at set, and an ordinary board spell sets for nothing.
  const playCost = def.kind === 'unit' ? unitSpCost(def) : cardSpCost(def);
  const setCost = setSpCost(def);

  const summonBlocked = sp < playCost
    ? `Summoning this costs ${playCost} SP — you have ${sp}.`
    : 'No room: the board is at its unit cap.';
  const castBlocked = sp < playCost
    ? `Casting this costs ${playCost} SP — you have ${sp}.`
    : 'Nothing on the board can be targeted by this.';
  const setBlocked = sp < setCost
    ? `Setting this costs ${setCost} SP — you have ${sp}.`
    : `No room: the board is at its ${def.kind === 'unit' ? 'unit' : 'set-card'} cap.`;

  const canSet = playable.set.has(cardId);
  const out: HandPlay[] = [];

  if (def.kind === 'unit') {
    const canSummon = playable.summon.has(cardId);
    out.push({
      kind: 'summon',
      short: 'summon',
      long: 'Summon face-up',
      cost: playCost,
      enabled: canSummon,
      title: canSummon ? `Summon face-up for ${playCost} SP` : summonBlocked,
    });
  }

  if (def.kind === 'spell' && !isMineOnly(def)) {
    const canCast = playable.cast.has(cardId);
    out.push({
      kind: 'cast',
      short: 'cast',
      long: 'Cast',
      cost: playCost,
      enabled: canCast,
      title: canCast ? `Cast for ${playCost} SP` : castBlocked,
    });
  }

  // Any card — unit, spell, or trap — can be set face-down (universal bluff).
  out.push({
    kind: 'set',
    short: 'set',
    long: 'Set face-down',
    cost: setCost,
    enabled: canSet,
    title: canSet ? `Set face-down${setCost > 0 ? ` for ${setCost} SP` : ' for free'}` : setBlocked,
  });

  // A face-down UNIT picks its stance on the way down. Since 2026-08-16 being hidden is not a
  // posture, so this is the only way a set unit ends up fighting on DEF.
  if (def.kind === 'unit') {
    out.push({
      kind: 'setDef',
      short: 'set def',
      long: 'Set face-down, defending',
      cost: setCost,
      enabled: canSet,
      title: canSet ? 'Set face-down in defense position' : setBlocked,
    });
  }

  return out;
}
