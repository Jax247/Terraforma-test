import clsx from 'clsx';
import type { HTMLAttributes, ReactNode } from 'react';
import styles from './Panel.module.scss';

export interface PanelProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  /** Inscribed heading. Omit for an unlabelled container. */
  title?: ReactNode;
  /** Right-aligned metadata on the header row — counts, totals, status. */
  aside?: ReactNode;
  /** Draw the gold rule under the header. */
  ruled?: boolean;
  /** Drop the internal padding (for panels whose child owns its own spacing). */
  flush?: boolean;
  sunken?: boolean;
  /** Rendered element — use 'section' with a title so the heading forms a landmark. */
  as?: 'div' | 'section' | 'aside';
  children?: ReactNode;
}

/** The app's surface primitive: a titled slate card. */
export function Panel({
  title,
  aside,
  ruled = false,
  flush = false,
  sunken = false,
  as: Tag = 'div',
  className,
  children,
  ...rest
}: PanelProps) {
  return (
    <Tag className={clsx(styles['panel'], flush && styles['flush'], sunken && styles['sunken'], className)} {...rest}>
      {(title || aside) && (
        <div className={clsx(styles['header'], ruled && styles['ruled'])}>
          {title && <h3 className={styles['title']}>{title}</h3>}
          {aside && <span className={styles['aside']}>{aside}</span>}
        </div>
      )}
      <div className={styles['body']}>{children}</div>
    </Tag>
  );
}
