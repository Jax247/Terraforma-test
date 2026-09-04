import clsx from 'clsx';
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import type { BattleReport, BattleSide, StatTerm } from '../../engine';
import { CardArtImage, typeAccent } from '../components/CardFrame';
import { Icon } from '../components/Icon';
import { useGameMotionDuration } from '../motion';

/**
 * The brief look at a fight as it happens.
 *
 * Combat in this game is decided by numbers that are nowhere on the cards: terrain on the
 * defended tile, a leader's aura, flanking allies, a status with two turns left. The log records
 * the arithmetic AFTER the fact, in one line, by which point the loser is off the board — so the
 * question "why did my 45 lose to a 30?" had no answer you could see. This shows the sum.
 *
 * ⚠ Everything here is read from the engine's own {@link BattleReport}, which is built inside
 * `resolveCombat` from the same computation that decided the fight. Nothing is recalculated: the
 * board state has already moved on, and a second derivation would be free to disagree with the
 * result it is captioning.
 *
 * Not a dialog and not focus-stealing: a fight is something that HAPPENED, so interrupting the
 * player to acknowledge it would be wrong. It announces itself politely, dismisses on a click or
 * any key, and times out on its own.
 */
const DWELL_MS = 2600;

export function BattlePopup({
  battles,
  /** Whose side of the table to show on the left. */
  viewer,
  onDone,
}: {
  /**
   * ⚠ A CAPTURED copy, not `game.battles` read live. The popup outlives the state that produced
   * it — at AI speed the next action lands ~350ms later, and deriving this from the current
   * state made the panel vanish mid-sentence the moment an action resolved without a fight.
   */
  battles: BattleReport[];
  viewer: 0 | 1;
  onDone: () => void;
}) {
  // An action can resolve more than one exchange (a trigger that fights, a chain of them), so
  // they are played through one at a time rather than the last one silently winning.
  const [index, setIndex] = useState(0);
  const battle = battles[index];
  const duration = useGameMotionDuration(0.16);

  useEffect(() => {
    setIndex(0);
  }, [battles]);

  useEffect(() => {
    if (!battle) return;
    const next = () => (index + 1 < battles.length ? setIndex(index + 1) : onDone());
    const timer = setTimeout(next, DWELL_MS);
    // Any key moves it along — a player who has read it should not have to wait out the timer,
    // and one who is mid-thought should not have their next keystroke swallowed by a popup.
    const onKey = () => next();
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('keydown', onKey);
    };
  }, [battle, index, battles.length, onDone]);

  if (!battle) return null;

  // The viewer's own piece reads on the left, whichever side of the fight it was on.
  const mine = battle.attacker.owner === viewer ? battle.attacker : battle.defender;
  const theirs = mine === battle.attacker ? battle.defender : battle.attacker;

  return (
    // ⚠ Centred by the flex overlay, never by a transform on the popup itself: framer-motion
    // writes `transform` inline to animate `scale`, which silently overrides a
    // `translate(-50%, -50%)` in the stylesheet and drops the panel off the board's centre.
    //
    // The overlay is also what keeps the board underneath clickable — it takes no pointer
    // events, so only the panel's own footprint is blocked for the couple of seconds it is up.
    <div className="battle-overlay">
      <AnimatePresence>
        <motion.div
          key={index}
          className="battle-popup"
          role="status"
          aria-live="polite"
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.98 }}
          transition={{ duration }}
          onClick={onDone}
        >
          <div className="battle-head">
            <Icon name={battle.ranged ? 'shoot' : 'game'} size={13} />
            <span>{battle.ranged ? 'Ranged attack' : 'Battle'}</span>
            <span className="battle-at">
              ({battle.tile.col},{battle.tile.row})
            </span>
            {battles.length > 1 && (
              <span className="battle-count">
                {index + 1}/{battles.length}
              </span>
            )}
          </div>

          <div className="battle-sides">
            <Side side={mine} lifeLost={battle.lifeLoss[mine.owner]} />
            <div className="battle-vs" aria-hidden="true">
              vs
            </div>
            <Side side={theirs} lifeLost={battle.lifeLoss[theirs.owner]} />
          </div>

          {/* The engine's own log lines, so the caption and the log never tell different stories. */}
          <div className="battle-lines">
            {battle.lines.map((line, i) => (
              <div key={i}>{line}</div>
            ))}
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function Side({ side, lifeLost }: { side: BattleSide; lifeLost: number }) {
  const accent = typeAccent(side.type);
  // Base is the row the rest is measured against, so it is printed as the opening figure rather
  // than as a "+45 buff" alongside the things that actually modified it.
  const [base, ...mods] = side.breakdown.terms;

  return (
    <div className={clsx('battle-side', `battle-side-p${side.owner}`, side.destroyed && 'battle-side-lost')}>
      <div className="battle-card" style={accent ? { ['--card-accent' as string]: accent } : undefined}>
        <CardArtImage id={side.cardId} className="battle-art" />
        <span className="battle-scrim" />
        <span className="battle-name">{side.name}</span>
        {side.destroyed && (
          <span className="battle-destroyed">
            <Icon name="sick" size={20} />
          </span>
        )}
      </div>

      <div className="battle-total">
        <span className="battle-stat">{side.stat === 'def' ? 'DEF' : 'ATK'}</span>
        <span className="battle-value">{side.breakdown.total}</span>
      </div>

      <ul className="battle-terms">
        {base && (
          <li className="battle-term battle-term-base">
            <span>{base.label}</span>
            <span className="battle-amount">{base.amount}</span>
          </li>
        )}
        {mods.length === 0 ? (
          <li className="battle-term battle-term-none">no modifiers</li>
        ) : (
          mods.map((term, i) => <Term key={i} term={term} />)
        )}
      </ul>

      {/*
        What this exchange COST, not the running total — overflow, a pierce, a wall's reflect, or
        the chip a leader took. The running total is on the status bar; the interesting number
        here is the one this fight produced. Shown for any side that paid, leader or not: a unit
        losing a fight bills its owner's pool.
      */}
      {lifeLost > 0 && <div className="battle-lp">−{lifeLost} LP</div>}
    </div>
  );
}

function Term({ term }: { term: StatTerm }) {
  return (
    <li className={clsx('battle-term', term.amount >= 0 ? 'battle-term-up' : 'battle-term-down')}>
      <span className="battle-term-label">{term.label}</span>
      <span className="battle-amount">
        {term.amount >= 0 ? '+' : '−'}
        {Math.abs(term.amount)}
      </span>
    </li>
  );
}
