import clsx from 'clsx';
import { motion } from 'framer-motion';
import { useState } from 'react';
import { effectiveAtk, effectiveDef, isSick } from '../../engine';
import type { GameState, Unit } from '../../engine';
import { isDisarmed, isSnared, isStunned, isSuppressed } from '../../engine/status';
import { Icon } from '../components/Icon';
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
  // Purely decorative: raises the token over the ones it flies past. Nothing waits
  // on it — if the animation never fires, the class simply never turns on.
  const [moving, setMoving] = useState(false);
  const badges = statusBadges(unit);
  const atk = effectiveAtk(game, unit);
  const def = effectiveDef(game, unit);

  // Text alternative for the tile's aria-label and for touch, where the badge
  // tooltips are unreachable.
  const summary = [
    `P${unit.owner + 1} ${unit.name}`,
    unit.isLeader ? 'leader' : null,
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
      layout
      layoutId={unit.id}
      transition={{ type: 'spring', stiffness: 400, damping: 34, mass: 0.7 }}
      onLayoutAnimationStart={() => setMoving(true)}
      onLayoutAnimationComplete={() => setMoving(false)}
      className={clsx(
        'unit',
        `unit-p${unit.owner}`,
        moving && 'unit-moving',
        sick && 'unit-sick',
        unit.isLeader && 'unit-leader',
        unit.stance === 'defense' && 'unit-defending',
      )}
      aria-label={summary}
    >
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

      <span className="unit-atk">
        {unit.isLeader && <Icon name="leader" size={12} className="unit-crown" />}
        {atk}
        {/* Leaders have no DEF — they are never attacked as a piece. */}
        {!unit.isLeader && <span className="unit-def">/{def}</span>}
      </span>
      <span className="unit-name">{unit.name}</span>
    </motion.div>
  );
}
