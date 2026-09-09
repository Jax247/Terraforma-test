/**
 * The 3D board, wired to the saved setting.
 *
 * Renders nothing. Its whole job is to keep the document in step with
 * `settings.board`: the CSS custom properties styles/_board3d.scss reads, the
 * focus-follow camera, and the WebGL terrain layer underneath the DOM board.
 *
 * Mounted once at the app shell rather than inside GameView, because the board is
 * not the only thing that answers to it — the app bar, the rails and the hand all
 * take the chrome wash — and because the GL layer wants to survive a board being
 * unmounted and rebuilt by New game.
 *
 * In Simple (2D) view this writes `data-board3d="off"`, no rule in _board3d.scss
 * matches, and the flat board is exactly the board that existed before any of this.
 * See src/ui/boardView.ts.
 */

import { useEffect } from 'react';
import { applyBoardView } from './boardView';
import type { BoardView } from './boardView';
import { BoardGL } from './BoardGL';

export function BoardScene({ view }: { view: BoardView }) {
  const on = view.mode === '3d';

  useEffect(() => applyBoardView(view), [view]);

  // Hold the focused tile at the centre of the board.
  //
  // Two numbers do it, and both are pure layout arithmetic. The PAN is the vector
  // from the focused tile's centre to the board's centre, which the stylesheet
  // applies innermost so it slides the board in its own unrotated plane. The EYE
  // then parks on the board's centre, which is what makes the result exact rather
  // than approximate — the reasoning is written out over the transform in
  // _board3d.scss.
  //
  // Read off LAYOUT (`offsetLeft/Top`), never `getBoundingClientRect`. The rect is
  // the PROJECTED position, which is a function of the pan we are computing — so
  // measuring it would chase its own tail and drift on every keypress. Layout
  // position does not move when the transform does, so this settles in one pass.
  // It is flip-safe for free too: seat 1 renders the grid in reversed order, and
  // the focused tile's layout box moves with it.
  //
  // `focusin` rather than the Board's own onFocusTile because it costs this
  // component nothing: clicking a tile ends in a real .focus() (Board.tsx does this
  // deliberately so the ring and the grid cursor agree), so both the mouse and the
  // arrow keys arrive here already.
  useEffect(() => {
    const root = document.documentElement;
    const clear = () => {
      delete root.dataset['board3dTrack'];
      for (const v of ['--board3d-pan-x', '--board3d-pan-y', '--board3d-eye-x', '--board3d-eye-y']) {
        root.style.removeProperty(v);
      }
    };
    if (!on || !view.follow) {
      clear();
      return;
    }
    root.dataset['board3dTrack'] = 'on';
    const aim = () => {
      const tile = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('.tile');
      const board = tile?.closest<HTMLElement>('.board');
      const col = board?.closest<HTMLElement>('.board-col');
      // No column means this is the map editor's grid, not the game board — it
      // borrows the same classes and must not move the game camera.
      if (!tile || !board || !col || !col.offsetWidth || !col.offsetHeight) return;
      // ⚠ TWO coordinate spaces, and they are easy to mix up — the first cut of
      // this subtracted one from the other and put every tile 140px off centre.
      // `.board` carries a transform, and a transformed element becomes the
      // containing block for its descendants, so it is the tiles' offsetParent:
      // `tile.offsetLeft` is measured inside the BOARD, while `board.offsetLeft`
      // is measured inside the COLUMN.
      //
      // So the pan is computed entirely in board space (clientWidth is the board
      // inside its border, which is the origin tile offsets are measured from)...
      root.style.setProperty('--board3d-pan-x', `${board.clientWidth / 2 - (tile.offsetLeft + tile.offsetWidth / 2)}px`);
      root.style.setProperty('--board3d-pan-y', `${board.clientHeight / 2 - (tile.offsetTop + tile.offsetHeight / 2)}px`);
      // ...and the eye entirely in column space, which is what perspective-origin
      // resolves its percentages against.
      root.style.setProperty('--board3d-eye-x', `${((board.offsetLeft + board.offsetWidth / 2) / col.offsetWidth) * 100}%`);
      root.style.setProperty('--board3d-eye-y', `${((board.offsetTop + board.offsetHeight / 2) / col.offsetHeight) * 100}%`);
    };
    /**
     * ⚠ NEVER PAN WHILE A POINTER IS DOWN. This is what makes the close camera clickable
     * at all, and without it the board looks fine and simply refuses to accept moves.
     *
     * The browser focuses a tile on MOUSEDOWN. That fires `focusin`, which used to pan
     * immediately — so by the time the button came up, the tile had slid out from under
     * the cursor. Chromium then dispatches `click` on the nearest common ancestor of the
     * mousedown and mouseup targets, which is `.board`, and the tile's own onClick never
     * runs. Measured at zoom 2.1: every click that changed the focused tile was swallowed
     * this way, at hold times of 0ms, 80ms and 300ms alike. You could look around the
     * board and never move a piece.
     *
     * So a pan raised while the button is down is held until after the click has been
     * dispatched. `setTimeout` rather than the `pointerup` handler itself, because click
     * is dispatched synchronously after mouseup in the same task — a macrotask lands
     * strictly after it. `pointercancel` covers the drag-off case, where no click comes.
     *
     * The keyboard path is untouched: arrow keys fire `focusin` with no pointer down, so
     * they still pan the instant focus moves.
     */
    let holding = false;
    const onFocusIn = () => {
      if (!holding) aim();
    };
    const hold = () => {
      holding = true;
    };
    const release = () => {
      if (!holding) return;
      window.setTimeout(() => {
        holding = false;
        aim();
      }, 0);
    };
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('pointerdown', hold, true);
    document.addEventListener('pointerup', release, true);
    document.addEventListener('pointercancel', release, true);
    aim();
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('pointerdown', hold, true);
      document.removeEventListener('pointerup', release, true);
      document.removeEventListener('pointercancel', release, true);
      clear();
    };
  }, [on, view.follow]);

  return (
    <BoardGL
      on={on && view.gl}
      props={view.scenery}
      style={view.photoreal ? 'photoreal' : 'stylised'}
      size={view.hires ? 1024 : 512}
    />
  );
}
