import { Button } from './components/Button';
import { Icon } from './components/Icon';
import { Modal } from './Modal';
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
    </Modal>
  );
}
