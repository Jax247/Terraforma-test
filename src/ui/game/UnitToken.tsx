import clsx from 'clsx';
import { motion } from 'framer-motion';
import { useState } from 'react';
import type { CSSProperties } from 'react';
import { effectiveAtk, effectiveDef, isSick } from '../../engine';
import type { GameState, Unit } from '../../engine';
import { isDisarmed, isSnared, isStunned, isSuppressed } from '../../engine/status';
import { CardArtImage, typeAccent } from '../components/CardFrame';
import { Icon } from '../components/Icon';
import { useGameMotion } from '../motion';
import type { IconName } from '../components/Icon';

/**
 * Statuses worth a badge, in priority order. Stunned subsumes Snared+Disarmed, so
 * it is checked first and the components are not doubled up.
 *
 * This is new: the denial axis shipped as a mechanic with no board-level visual at
 * all, so a stunned unit was indistinguishable from a healthy one.
 */
function statusBadges(unit: Unit): { key: string; icon: IconName; className: string; label: string }[] {
  const badges: { key: string; icon: IconName; className: string; label: string }[] = [];
  if (isSuppressed(unit))
    badges.push({ key: 'sup', icon: 'suppressed', className: 'badge-suppressed', label: 'Suppressed — own rules and keywords inert' });
  if (isStunned(unit)) {
    badges.push({ key: 'stun', icon: 'stunned', className: 'badge-stunned', label: 'Stunned — cannot move or attack, and is safe to attack' });
  } else {
    if (isSnared(unit)) badges.push({ key: 'snare', icon: 'snared', className: 'badge-snared', label: 'Snared — cannot move' });
    if (isDisarmed(unit))
      badges.push({ key: 'dis', icon: 'disarmed', className: 'badge-disarmed', label: 'Disarmed — cannot attack, and is safe to attack' });
  }
  if (unit.stance === 'defense')
    badges.push({ key: 'def', icon: 'defending', className: 'badge-defending', label: 'Defending — attacked against DEF, cannot move or attack' });
  return badges;
}

export function UnitToken({
  game,
  unit,
  onInspect,
}: {
  game: GameState;
  unit: Unit;
  onInspect: () => void;
}) {
  const sick = isSick(unit);
  /**
   * Whether the token TWEENS to its new tile or simply appears there.
   *
   * The props below are dropped rather than the animation being disabled through
   * <MotionConfig> or a zero duration, because neither of those reaches framer's layout
   * projection — and a zeroed duration is actively worse, leaving the measured delta
   * stuck on the element as an inline transform with nothing left to clear it. See
   * useGameMotion.
   *
   * `full` and not `!== 'off'`: a 156px flight across the board is exactly the kind of
   * large-area movement `prefers-reduced-motion` is asking us not to make. Projection
   * ignores framer's own `reducedMotion` switch, so honouring it has to happen here.
   */
  const travels = useGameMotion() === 'full';
  // Purely decorative: raises the token over the ones it flies past. Nothing waits
  // on it — if the animation never fires, the class simply never turns on.
  const [moving, setMoving] = useState(false);
  const badges = statusBadges(unit);
  const atk = effectiveAtk(game, unit);
  const def = effectiveDef(game, unit);
  const accent = typeAccent(unit.type);

  // Text alternative for the tile's aria-label and for touch, where the badge
  // tooltips are unreachable. The stance is spelled out because the visual cue for
  // it is the card's ORIENTATION, which carries nothing to a screen reader.
  const summary = [
    `P${unit.owner + 1} ${unit.name}`,
    unit.isLeader ? 'leader' : null,
    unit.isLeader ? null : `${unit.stance} position`,
    `ATK ${atk}`,
    unit.isLeader ? null : `DEF ${def}`,
    sick ? `summoning-sick for ${unit.sickTurns} more turn(s)` : null,
    ...badges.map((b) => b.label),
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <motion.div
      // `layout` tweens the token between tiles. It chases state that has ALREADY
      // committed — the unit is at its new coordinate the instant the action applies,
      // and nothing waits for this animation. See src/ui/motion.ts.
      //
      // ⚠ Keep this element free of transforms: the quarter-turn for defense stance
      // lives on `.unit-card` INSIDE it. Layout projection measures this box, and a
      // rotation on the measured element makes that measurement meaningless.
      layout={travels}
      layoutId={travels ? unit.id : undefined}
      transition={{ type: 'spring', stiffness: 400, damping: 34, mass: 0.7 }}
      onLayoutAnimationStart={() => setMoving(true)}
      onLayoutAnimationComplete={() => setMoving(false)}
      className={clsx('unit', `unit-p${unit.owner}`, travels && moving && 'unit-moving', sick && 'unit-sick', unit.isLeader && 'unit-leader')}
      aria-label={summary}
    >
      {/*
        The piece is a CARD, and the stance is which way up it sits: upright for
        attack, turned a quarter-turn for defense — the tabletop convention, read
        at a glance from across the board without decoding a badge.

        Everything that rotates lives in here. The badges and the info button below
        are board chrome, not part of the card, so they stay upright and stay put.
      */}
      <div
        className={clsx('unit-card', unit.stance === 'defense' && 'unit-card-defending')}
        style={accent ? ({ '--card-accent': accent } as CSSProperties) : undefined}
      >
        {/* Inset by the frame's width and clipped to the same silhouette, so the
            faction colour behind it reads as a border all the way round. */}
        <span className="unit-well">
          {/* Art coverage is incremental: a card with no file renders nothing here
              and the frame's faction gradient shows through as the plate. */}
          <CardArtImage id={unit.cardId} className="unit-art" />
          <span className="unit-scrim" />
        </span>

        <span className="unit-text">
          <span className="unit-name">{unit.name}</span>
          <span className="unit-atk">
            {unit.isLeader && <Icon name="leader" size={12} className="unit-crown" />}
            {atk}
            {/* Leaders have no DEF — they are never attacked as a piece. */}
            {!unit.isLeader && <span className="unit-def">/{def}</span>}
          </span>
        </span>
      </div>

      {badges.length > 0 && (
        <span className="unit-badges">
          {badges.map((b) => (
            <span key={b.key} className={clsx('unit-badge', b.className)} title={b.label}>
              <Icon name={b.icon} size={10} />
            </span>
          ))}
        </span>
      )}

      <button
        type="button"
        className="unit-info"
        aria-label={`Card details for ${unit.name}`}
        onClick={(e) => {
          e.stopPropagation();
          onInspect();
        }}
      >
        <Icon name="info" size={11} />
      </button>
    </motion.div>
  );
}
