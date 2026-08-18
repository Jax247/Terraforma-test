// The AI turn driver: while an AI seat is active, apply one policy action per tick.
//
// Lifted out of App.tsx unchanged. The StrictMode-safe shape is load-bearing and
// must not be "simplified": the cleanup cancels the pending tick, and the functional
// updater re-checks phase and controller so a stray timer that fires anyway is a no-op.
//
// Note the cadence is governed solely by `speedMs`. It is deliberately independent of
// the animation state — a self-play game runs at the same rate with motion on or off
// (see src/ui/motion.ts).

import { useEffect } from 'react';
import type { MutableRefObject } from 'react';
import { applyAction } from '../engine';
import type { GameState } from '../engine';
import type { Policy } from '../ai';
import type { Controller } from './storage';

export interface AiDriverOptions {
  game: GameState | null;
  setGame: (update: (g: GameState | null) => GameState | null) => void;
  controllers: [Controller, Controller];
  policiesRef: MutableRefObject<[Policy, Policy]>;
  /** Milliseconds between AI actions. */
  speedMs: number;
  /**
   * False suspends the driver entirely — used when the player has navigated away
   * from the game, or when an online session owns the turn order instead.
   */
  enabled: boolean;
  /** Guard read at fire time: true if an online session took over since scheduling. */
  isOnlineRef: MutableRefObject<boolean>;
}

export function useAiDriver({
  game,
  setGame,
  controllers,
  policiesRef,
  speedMs,
  enabled,
  isOnlineRef,
}: AiDriverOptions): void {
  useEffect(() => {
    if (!enabled || !game || game.phase === 'gameover' || controllers[game.active] !== 'ai') return;
    const timer = setTimeout(() => {
      setGame((g) => {
        if (!g || isOnlineRef.current || g.phase === 'gameover' || controllers[g.active] !== 'ai') return g;
        try {
          return applyAction(g, policiesRef.current[g.active](g, g.active));
        } catch (e) {
          console.error('AI action failed; ending its turn', e);
          try {
            return applyAction(g, { t: 'EndTurn' });
          } catch {
            return g;
          }
        }
      });
    }, speedMs);
    return () => clearTimeout(timer);
  }, [game, controllers, enabled, speedMs, setGame, policiesRef, isOnlineRef]);
}

/** True when an AI seat is mid-turn — drives the "🤖 P<n> is playing…" indicator. */
export function isAiThinking(
  game: GameState | null,
  controllers: [Controller, Controller],
  enabled: boolean,
): boolean {
  return enabled && game !== null && game.phase !== 'gameover' && controllers[game.active] === 'ai';
}
