/**
 * The 3D board's dial box.
 *
 * Deliberately NOT a section of the Settings dialog. A modal drops a backdrop over
 * the board, and a camera you cannot see while you move it is a camera you cannot
 * judge — every one of these dials is a "does that read better?" question. So
 * Settings owns the choice between 3D and Simple, and hands off to this, which
 * floats over the live board.
 *
 * Every change writes straight through to the saved settings: there is no apply
 * step, because the board itself is the preview.
 */

import { useState } from 'react';
import { Button } from './components/Button';
import { Icon } from './components/Icon';
import { BOARD_VIEW_DEFAULTS, CAMERA_SLIDERS, CAMERA_TOGGLES, DETAIL_SLIDERS, TERRAIN_TOGGLES } from './boardView';
import type { BoardView, SliderSpec, ToggleSpec } from './boardView';
import styles from './BoardTuner.module.scss';

export interface BoardTunerProps {
  view: BoardView;
  onChange: (next: BoardView) => void;
  onClose: () => void;
}

export function BoardTuner({ view, onChange, onClose }: BoardTunerProps) {
  // What the pointer or the keyboard is currently on. One shared line rather than a
  // hint under every row: fifteen permanent captions would be taller than the board.
  const [hint, setHint] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  /**
   * Persist the current dials as the defaults, on disk.
   *
   * Dev-server only by design — the endpoint is an `apply: 'serve'` plugin, so a
   * production build simply has nowhere to write and says so rather than failing
   * silently. It exists because settings otherwise live only in localStorage, where
   * they are invisible to everyone but the browser holding them; this is what makes
   * a camera someone actually settled on reviewable, shareable and diffable.
   */
  async function saveDefaults() {
    try {
      const res = await fetch('/__boardview/defaults', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(view),
      });
      setSaved(res.ok ? 'Written to boardView.defaults.json.' : `Failed: ${await res.text()}`);
    } catch {
      setSaved('Failed — needs the dev server.');
    }
    window.setTimeout(() => setSaved(null), 4000);
  }

  const slider = (spec: SliderSpec) => (
    <label
      key={spec.key}
      className={styles['row']}
      onPointerEnter={() => setHint(spec.hint)}
      onFocus={() => setHint(spec.hint)}
    >
      <span className={styles['rowLabel']}>{spec.label}</span>
      <input
        type="range"
        min={spec.min}
        max={spec.max}
        step={spec.step}
        value={view[spec.key]}
        onChange={(e) => onChange({ ...view, [spec.key]: Number(e.target.value) })}
        className={styles['range']}
      />
      <span className={styles['value']}>
        {(spec.fmt ?? String)(view[spec.key])}
        {spec.unit}
      </span>
    </label>
  );

  const toggle = (spec: ToggleSpec) => (
    <label
      key={spec.key}
      className={styles['toggle']}
      onPointerEnter={() => setHint(spec.hint)}
      onFocus={() => setHint(spec.hint)}
    >
      <input
        type="checkbox"
        checked={view[spec.key]}
        onChange={(e) => {
          const next = { ...view, [spec.key]: e.target.checked };
          // Height is what the terrain layer is FOR, so switching it on with the
          // relief dial at zero would draw a flat slab and read as a failure. The
          // dial still drives both layers; this only refuses to start it at nothing.
          if (spec.key === 'gl' && e.target.checked && view.relief === 0) next.relief = BOARD_VIEW_DEFAULTS.relief || 9;
          onChange(next);
        }}
      />
      {spec.label}
    </label>
  );

  return (
    <div className={styles['tuner']} role="group" aria-label="Tune the 3D board" onPointerLeave={() => setHint(null)}>
      <div className={styles['head']}>
        <span className={styles['title']}>3D board</span>
        <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close the board tuner">
          <Icon name="close" size={14} />
        </Button>
      </div>

      <div className={styles['body']}>
        <p className={styles['hint']}>{hint ?? 'Every change applies to the board behind this panel as you make it.'}</p>

        <div className={styles['section']}>
          <div className={styles['sectionTitle']}>Camera</div>
          {CAMERA_SLIDERS.map(slider)}
          {CAMERA_TOGGLES.map(toggle)}
        </div>

        <div className={styles['section']}>
          <div className={styles['sectionTitle']}>Table</div>
          {DETAIL_SLIDERS.map(slider)}
        </div>

        <div className={styles['section']}>
          <div className={styles['sectionTitle']}>Terrain</div>
          {TERRAIN_TOGGLES.map(toggle)}
        </div>
      </div>

      <div className={styles['foot']}>
        <Button size="sm" variant="ghost" block onClick={() => onChange({ ...BOARD_VIEW_DEFAULTS, mode: view.mode })}>
          Reset
        </Button>
        {/* Dev only: the write endpoint is an `apply: 'serve'` Vite plugin, so a
            production build has nowhere to post and the button would be dead. */}
        {import.meta.env.DEV && (
          <Button size="sm" variant="ghost" block onClick={saveDefaults} title="Write these dials to src/ui/boardView.defaults.json">
            Save as defaults
          </Button>
        )}
      </div>
      {saved && <div className={styles['note']}>{saved}</div>}
    </div>
  );
}
