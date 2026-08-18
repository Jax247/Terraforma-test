import clsx from 'clsx';
import { motion } from 'framer-motion';
import type { GameState, PlayerId } from '../../engine';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { Panel } from '../components/Panel';

/** Pip ceiling. SP is a small refresh-costed pool, so a row of pips reads faster than a number. */
const SP_PIPS = 10;

/** Starting LP, used only to scale the bars. */
const LP_FULL = 200;

export function StatusHud({
  game,
  active,
  viewer,
  sp,
  turnCount,
  boardName,
  seat,
  myTurn,
  canEndTurn,
  onEndTurn,
}: {
  game: GameState;
  active: PlayerId;
  viewer: PlayerId;
  sp: number;
  turnCount: number;
  boardName?: string | undefined;
  /** Online only: the fixed local seat. */
  seat?: PlayerId | undefined;
  myTurn: boolean;
  canEndTurn: boolean;
  onEndTurn: () => void;
}) {
  const pips = Math.max(SP_PIPS, sp);

  return (
    <Panel className="hud">
      <div className="hud-top">
        <div className="hud-active">
          <span className={clsx('hud-seat', `hud-seat-${active}`)}>P{active + 1}</span>
          <span className="hud-leader">{game.leaders[active].name}</span>
        </div>
        <Button variant="accent" size="sm" disabled={!canEndTurn} onClick={onEndTurn}>
          End turn
        </Button>
      </div>

      <div className="hud-turn">
        {/* Online: whose turn it is is the most important fact on the screen. */}
        {seat !== undefined && (
          <span className={myTurn ? 'hud-your-turn' : undefined}>
            {myTurn ? 'Your turn' : 'Opponent’s turn'} ·{' '}
          </span>
        )}
        Turn {turnCount}
        {boardName && (
          <>
            {' · '}
            <Icon name="map" size={11} /> {boardName}
          </>
        )}
      </div>

      <div className="hud-lp-row">
        {([0, 1] as PlayerId[]).map((p) => {
          const lp = game.players[p].leaderLife;
          return (
            <div key={p} className="hud-lp">
              <span className="hud-lp-label">
                P{p + 1}
                {p === viewer ? '*' : ''}
              </span>
              <span className="hud-lp-bar">
                <motion.span
                  className={clsx('hud-lp-fill', `hud-lp-${p}`)}
                  // Driven from committed state — the number below is already the
                  // new value whether or not the bar has finished moving.
                  animate={{ width: `${Math.max(0, Math.min(100, (lp / LP_FULL) * 100))}%` }}
                  initial={false}
                />
              </span>
              <span className="hud-lp-value">{lp}</span>
            </div>
          );
        })}
      </div>

      <div className="hud-sp">
        <span className="hud-lp-label">SP</span>
        <span className="hud-pips" role="img" aria-label={`${sp} spirit points`}>
          {Array.from({ length: pips }, (_, i) => (
            <span key={i} className={clsx('hud-pip', i < sp && 'hud-pip-full')} />
          ))}
        </span>
        <span className="hud-lp-value">{sp}</span>
      </div>
    </Panel>
  );
}
