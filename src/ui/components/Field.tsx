import clsx from 'clsx';
import { useId } from 'react';
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import styles from './Field.module.scss';

interface FieldShellProps {
  label: ReactNode;
  hint?: ReactNode;
  /** Label beside the control instead of above it — for dense knob rows. */
  inline?: boolean;
  /** Mark the value as changed from its default. */
  dirty?: boolean;
  className?: string;
  children: (id: string, describedBy: string | undefined) => ReactNode;
}

/**
 * Label + control + hint, wired together with real ids. Every control in the app
 * goes through this so no input is left with a floating, unassociated label.
 */
export function Field({ label, hint, inline = false, dirty = false, className, children }: FieldShellProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div className={clsx(styles['field'], inline && styles['inline'], dirty && styles['dirty'], className)}>
      <label className={styles['label']} htmlFor={id}>
        {label}
      </label>
      {children(id, hintId)}
      {hint && (
        <span className={styles['hint']} id={hintId}>
          {hint}
        </span>
      )}
    </div>
  );
}

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'className'> & { className?: string; numeric?: boolean };

export function TextInput({ className, numeric = false, ...rest }: InputProps) {
  return <input className={clsx(styles['control'], numeric && styles['numeric'], className)} {...rest} />;
}

export function Select({ className, ...rest }: Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className'> & { className?: string }) {
  return <select className={clsx(styles['control'], className)} {...rest} />;
}

export function TextArea({ className, ...rest }: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'className'> & { className?: string }) {
  return <textarea className={clsx(styles['control'], styles['textarea'], className)} {...rest} />;
}
