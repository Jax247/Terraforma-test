import { motion } from 'framer-motion';
import type { GameState, PlayerId } from '../../engine';
import { Button } from '../components/Button';

export function WinnerOverlay({
  game,
  winner,
  online,
  onNewGame,
  onViewLog,
}: {
  game: GameState;
  winner: PlayerId;
  /** Online games leave the room rather than starting a fresh one. */
  online: boolean;
  onNewGame: () => void;
  onViewLog: () => void;
}) {
  return (
    <motion.div
      className="winner"
      role="alertdialog"
      aria-label="Game over"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.35 }}
    >
      <motion.div
        className="winner-title"
        initial={{ opacity: 0, y: 12, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.4, delay: 0.1 }}
      >
        Player {winner + 1} wins
      </motion.div>
      <div className="winner-sub">{game.leaders[winner].name} holds the field.</div>
      <div className="button-row">
        <Button variant="accent" size="lg" onClick={onNewGame}>
          {online ? 'Leave room' : 'New game'}
        </Button>
        <Button size="lg" onClick={onViewLog}>
          View full log
        </Button>
      </div>
    </motion.div>
  );
}
