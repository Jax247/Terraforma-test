import clsx from 'clsx';
import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import styles from './Chip.module.scss';

export type ChipTone = 'default' | 'accent' | 'ok' | 'warn' | 'danger';

const STAT_TONE: Record<ChipTone, string | undefined> = {
  default: undefined,
  accent: styles['accentValue'],
  ok: undefined,
  warn: styles['warnValue'],
  danger: styles['dangerValue'],
};

/** A labelled number — "ATK 50", "DC 12". Mono, so a column of them lines up. */
export function StatChip({
  label,
  value,
  tone = 'default',
  className,
}: {
  label: string;
  value: ReactNode;
  tone?: ChipTone;
  className?: string;
}) {
  return (
    <span className={clsx(styles['stat'], STAT_TONE[tone], className)}>
      <span className={styles['statLabel']}>{label}</span>
      <span className={styles['statValue']}>{value}</span>
    </span>
  );
}

const TAG_TONE: Record<ChipTone, string | undefined> = {
  default: undefined,
  accent: styles['tagAccent'],
  ok: styles['tagOk'],
  warn: styles['tagWarn'],
  danger: styles['tagDanger'],
};

export interface TagProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  tone?: ChipTone;
  className?: string;
  children?: ReactNode;
}

/** A static pill: keyword, card kind, faction. */
export function Tag({ tone = 'default', className, children }: Omit<TagProps, 'onClick'>) {
  return <span className={clsx(styles['tag'], TAG_TONE[tone], className)}>{children}</span>;
}

/**
 * A pill that opens something — used for keyword glosses, which were `title=`
 * tooltips and therefore unreachable on touch and by keyboard.
 *
 * forwardRef is required, not incidental: Popover measures its trigger to position
 * itself, and a plain function component silently swallows the ref.
 */
export const TagButton = forwardRef<HTMLButtonElement, TagProps>(function TagButton(
  { tone = 'default', className, children, ...rest },
  ref,
) {
  return (
    <button ref={ref} type="button" className={clsx(styles['tag'], TAG_TONE[tone], className)} {...rest}>
      {children}
    </button>
  );
});
