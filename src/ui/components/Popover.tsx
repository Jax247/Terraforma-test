import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import styles from './Popover.module.scss';

/**
 * A small explanatory panel anchored to its trigger.
 *
 * This exists because the old UI put load-bearing rules text — keyword glosses,
 * terrain state, sickness counters — into `title=` tooltips. Those are hover-only:
 * unreachable on touch, and invisible to keyboard users. A popover opens on click,
 * closes on Escape or outside click, and is announced.
 *
 * Rendered in a portal and positioned `fixed` so it is never clipped by a scrolling
 * panel — which is where most of these triggers live.
 */
export function Popover({
  title,
  content,
  children,
}: {
  title?: string;
  content: ReactNode;
  /** Render prop for the trigger; gets the props it must spread. */
  children: (props: {
    ref: React.Ref<HTMLButtonElement>;
    onClick: (e: React.MouseEvent) => void;
    'aria-expanded': boolean;
    'aria-describedby': string | undefined;
  }) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const id = useId();

  useLayoutEffect(() => {
    if (!open || !triggerRef.current || !panelRef.current) return;
    const t = triggerRef.current.getBoundingClientRect();
    const p = panelRef.current.getBoundingClientRect();
    const margin = 8;
    // Prefer below; flip above when there isn't room. Clamp horizontally so the
    // panel never runs off a narrow screen.
    const below = t.bottom + margin;
    const top = below + p.height > window.innerHeight ? Math.max(margin, t.top - p.height - margin) : below;
    const left = Math.min(Math.max(margin, t.left), window.innerWidth - p.width - margin);
    setPos({ top, left });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!panelRef.current?.contains(target) && !triggerRef.current?.contains(target)) setOpen(false);
    };
    // Re-anchoring on scroll is more trouble than it's worth; close instead.
    const onScroll = () => setOpen(false);
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open]);

  return (
    <>
      {children({
        ref: triggerRef,
        onClick: (e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        },
        'aria-expanded': open,
        'aria-describedby': open ? id : undefined,
      })}
      {open &&
        createPortal(
          <div
            ref={panelRef}
            id={id}
            role="tooltip"
            className={styles['panel']}
            // Hidden until measured, so it never flashes at 0,0.
            style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, visibility: pos ? 'visible' : 'hidden' }}
          >
            {title && <div className={styles['title']}>{title}</div>}
            {content}
          </div>,
          document.body,
        )}
    </>
  );
}
