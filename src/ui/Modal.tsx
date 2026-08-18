import clsx from 'clsx';
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { Button } from './components/Button';
import { Icon } from './components/Icon';
import styles from './components/Modal.module.scss';

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Stack above another open modal (detail over zone list). */
  top?: boolean;
  /** Roomier dialog — for the full log and the zone browser. */
  wide?: boolean;
  /** Sized to a card portrait — for the card-detail view. */
  narrow?: boolean;
}

/** Focusable descendants, in tab order. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({ title, onClose, children, top, wide, narrow }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    // Remember where focus came from so it can be handed back on close.
    const opener = document.activeElement as HTMLElement | null;
    (dialog.querySelector<HTMLElement>(FOCUSABLE) ?? dialog).focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      // Trap: cycle within the dialog rather than escaping to the page behind it.
      const items = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKey, true);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = prevOverflow;
      opener?.focus?.();
    };
  }, [onClose]);

  return (
    <AnimatePresence>
      <motion.div
        className={clsx(styles['backdrop'], top && styles['top'])}
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.12 }}
      >
        <motion.div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          className={clsx(styles['dialog'], wide && styles['wide'], narrow && styles['narrow'])}
          onClick={(e) => e.stopPropagation()}
          initial={{ opacity: 0, y: 8, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.98 }}
          transition={{ duration: 0.16 }}
        >
          <div className={styles['head']}>
            <h2 className={styles['title']} id={titleId}>
              {title}
            </h2>
            <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close">
              <Icon name="close" size={16} />
            </Button>
          </div>
          <div className={styles['body']}>{children}</div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
