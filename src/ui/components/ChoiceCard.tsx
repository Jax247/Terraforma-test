import clsx from 'clsx';
import type { ReactNode } from 'react';
import { Icon } from './Icon';
import styles from './ChoiceCard.module.scss';

export interface ChoiceCardProps {
  title: ReactNode;
  /** Short qualifier after the title — "custom", "probe". */
  tag?: ReactNode;
  blurb?: ReactNode;
  /** Chips on the bottom row — DC totals, warning counts. */
  badges?: ReactNode;
  /** Thumbnail: leader art, map preview. */
  figure?: ReactNode;
  selected: boolean;
  onSelect: () => void;
  /**
   * Secondary control rendered beside (not inside) the choice button — an inspect
   * link, a delete. Kept outside so it never becomes a nested button.
   */
  aside?: ReactNode;
  /** Radio semantics when the choices form one exclusive group. */
  role?: 'radio' | undefined;
  className?: string;
}

export function ChoiceCard({
  title,
  tag,
  blurb,
  badges,
  figure,
  selected,
  onSelect,
  aside,
  role,
  className,
}: ChoiceCardProps) {
  const button = (
    <button
      type="button"
      className={clsx(styles['choice'], selected && styles['selected'], className)}
      onClick={onSelect}
      {...(role ? { role, 'aria-checked': selected } : { 'aria-pressed': selected })}
    >
      {figure && <span className={styles['figure']}>{figure}</span>}
      <span className={styles['main']}>
        <span className={styles['titleRow']}>
          <span className={styles['title']}>{title}</span>
          {tag && <span className={styles['tag']}>{tag}</span>}
        </span>
        {blurb && <span className={styles['blurb']}>{blurb}</span>}
        {badges && <span className={styles['badges']}>{badges}</span>}
      </span>
      <span className={styles['check']}>
        <Icon name="check" size={16} />
      </span>
    </button>
  );

  if (!aside) return button;
  return (
    <div className={styles['row']}>
      {button}
      <div className={styles['aside']}>{aside}</div>
    </div>
  );
}
