import { useEffect, useState } from 'react';
import { Button } from './components/Button';
import { Icon } from './components/Icon';
import { Modal } from './Modal';
import { bindingsFor, DEFAULT_KEYBINDS, describeKeyEvent, keybindProblem, keyLabel, KEYBIND_SPECS } from './keybinds';
import type { BoardCommand, Keybinds } from './keybinds';
import { hasMotionOverride, MOTION_SETTING_LABELS, MOTION_SETTINGS } from './motion';
import type { MotionMode, MotionSetting } from './motion';
import type { StoredSettings } from './storage';
import styles from './SettingsDialog.module.scss';

const MOTION_HINT: Record<MotionSetting, string> = {
  auto: 'Follows your operating system’s “reduce motion” preference.',
  full: 'Units glide between tiles, cards fly to the board, damage floats.',
  reduced: 'Fades only — nothing slides or scales.',
  off: 'No animation at all.',
};

export interface SettingsDialogProps {
  settings: StoredSettings;
  onChange: (next: StoredSettings) => void;
  /** What the setting actually resolved to, after overrides. */
  resolved: MotionMode;
  onClose: () => void;
}

export function SettingsDialog({ settings, onChange, resolved, onClose }: SettingsDialogProps) {
  // A ?motion= param or an automated browser outranks the saved setting; say so
  // rather than letting the control look broken.
  const overridden = hasMotionOverride();

  return (
    <Modal title="Settings" onClose={onClose} top>
      <div className={styles['group']}>
        <div className={styles['groupTitle']}>Animations</div>
        <p className={styles['groupNote']}>{MOTION_HINT[settings.motion]}</p>

        <div className={styles['segmented']} role="radiogroup" aria-label="Animations">
          {MOTION_SETTINGS.map((option) => (
            <Button
              key={option}
              size="sm"
              variant="ghost"
              className={styles['segment']}
              active={settings.motion === option}
              role="radio"
              aria-checked={settings.motion === option}
              onClick={() => onChange({ ...settings, motion: option })}
            >
              {MOTION_SETTING_LABELS[option]}
            </Button>
          ))}
        </div>

        <div className={styles['resolved']}>
          Currently running as <span className={styles['resolvedValue']}>{resolved}</span>.
        </div>

        {overridden && (
          <div className={styles['override']}>
            <Icon name="warning" size={12} />
            Overridden by ?motion= or an automated browser
          </div>
        )}
      </div>

      <div className={styles['group']}>
        <div className={styles['groupTitle']}>Battle popup</div>
        <p className={styles['groupNote']}>
          {settings.battlePopup
            ? 'Each combat briefly shows both cards and the buffs and debuffs that decided it. Click it, or press any key, to move on early.'
            : 'Combat resolves straight to the log. The board still shows the result.'}
        </p>

        <div className={styles['segmented']} role="radiogroup" aria-label="Battle popup">
          {([true, false] as const).map((on) => (
            <Button
              key={String(on)}
              size="sm"
              variant="ghost"
              className={styles['segment']}
              active={settings.battlePopup === on}
              role="radio"
              aria-checked={settings.battlePopup === on}
              onClick={() => onChange({ ...settings, battlePopup: on })}
            >
              {on ? 'On' : 'Off'}
            </Button>
          ))}
        </div>
      </div>

      <KeybindGroup binds={settings.keybinds} onChange={(keybinds) => onChange({ ...settings, keybinds })} />
    </Modal>
  );
}

/**
 * Rebind the board's commands.
 *
 * Only the commands with no universal convention are here — grid navigation and Enter/Space
 * are the ARIA grid contract and are shown as fixed, so the panel doubles as the one place a
 * player can read the board's full key reference.
 */
function KeybindGroup({ binds, onChange }: { binds: Keybinds; onChange: (next: Keybinds) => void }) {
  // Which command is listening for its new key, if any.
  const [capturing, setCapturing] = useState<BoardCommand | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (capturing === null) return;
    /**
     * ⚠ On WINDOW, in the capture phase, so this runs before the Modal's own document-level
     * capture listener. Otherwise the dialog would close on the Escape that is meant to
     * abandon the capture, and Tab would move focus out mid-rebind.
     */
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        setCapturing(null);
        setProblem(null);
        return;
      }
      const pressed = describeKeyEvent(e);
      // A bare modifier: the player is still mid-chord. Keep listening.
      if (pressed === null) return;
      const why = keybindProblem(capturing, pressed, binds);
      if (why) {
        setProblem(why);
        return;
      }
      onChange({ ...binds, [capturing]: pressed });
      setCapturing(null);
      setProblem(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [capturing, binds, onChange]);

  const isDefault = KEYBIND_SPECS.every((spec) => binds[spec.command] === DEFAULT_KEYBINDS[spec.command]);

  return (
    <div className={styles['group']}>
      <div className={styles['groupTitle']}>Board keys</div>
      <p className={styles['groupNote']}>
        Click a key to change it, then press the one you want. Every action is also reachable
        with the mouse, so a rebind can never lock you out of a move.
      </p>

      {KEYBIND_SPECS.map((spec) => {
        const listening = capturing === spec.command;
        // The chosen key plus the platform gestures that always work for it.
        const [chosen, ...always] = bindingsFor(spec.command, binds);
        return (
          <div key={spec.command} className={styles['bindRow']}>
            <div className={styles['bindText']}>
              <div className={styles['bindLabel']}>{spec.label}</div>
              <div className={styles['bindHint']}>{spec.hint}</div>
            </div>
            <div className={styles['bindKeys']}>
              <Button
                size="sm"
                variant="ghost"
                className={styles['bindButton']}
                active={listening}
                aria-label={`${spec.label}: currently ${keyLabel(binds[spec.command])}. Activate to rebind.`}
                onClick={() => {
                  setProblem(null);
                  setCapturing(listening ? null : spec.command);
                }}
                // Leaving the button abandons the capture, so it cannot stay armed invisibly.
                onBlur={() => listening && setCapturing(null)}
              >
                {listening ? 'Press a key…' : keyLabel(chosen!)}
              </Button>
              {always.length > 0 && (
                <span className={styles['bindAlways']}>or {always.map((k) => keyLabel(k)).join(' / ')}</span>
              )}
            </div>
          </div>
        );
      })}

      {problem && (
        <div className={styles['override']} role="alert">
          <Icon name="warning" size={12} />
          {problem}
        </div>
      )}

      <div className={styles['bindRow']}>
        <div className={styles['bindHint']}>
          Arrow keys move the board cursor; Enter and Space act on the focused tile. Those are
          the standard grid keys and stay put.
        </div>
        <Button size="sm" variant="ghost" disabled={isDefault} onClick={() => onChange({ ...DEFAULT_KEYBINDS })}>
          Reset
        </Button>
      </div>
    </div>
  );
}
