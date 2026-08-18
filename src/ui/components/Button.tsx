import clsx from 'clsx';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import styles from './Button.module.scss';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Renders as a pressed toggle and sets aria-pressed. */
  active?: boolean;
  block?: boolean;
  className?: string;
  children?: ReactNode;
}

/**
 * The app's only button. Replaces the old `className="small active burn"` string
 * mashing, and — because `active` sets aria-pressed — makes toggle state audible
 * rather than colour-only.
 */
export function Button({
  variant = 'secondary',
  size = 'md',
  active = false,
  block = false,
  className,
  type = 'button',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      aria-pressed={active || undefined}
      className={clsx(styles['button'], styles[size], styles[variant], active && styles['active'], block && styles['block'], className)}
      {...rest}
    >
      {children}
    </button>
  );
}
