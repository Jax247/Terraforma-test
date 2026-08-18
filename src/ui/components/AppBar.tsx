import clsx from 'clsx';
import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import type { NetStatus } from '../../net/client';
import type { Controller } from '../storage';
import { Button } from './Button';
import { Icon } from './Icon';
import type { IconName } from './Icon';
import styles from './AppBar.module.scss';

export interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  /** Match child routes too (`/online` should stay lit on `/online/ABCD`). */
  end?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Game', icon: 'game', end: true },
  { to: '/decks', label: 'Decks', icon: 'decks' },
  { to: '/build', label: 'Builder', icon: 'build' },
  { to: '/boards', label: 'Boards', icon: 'boards' },
  { to: '/online', label: 'Online', icon: 'online' },
];

const STATUS_TEXT: Record<NetStatus, string> = {
  open: 'Connected',
  connecting: 'Connecting',
  reconnecting: 'Reconnecting',
  closed: 'Offline',
};

const STATUS_CLASS: Record<NetStatus, string> = {
  open: 'statusOpen',
  connecting: 'statusPending',
  reconnecting: 'statusPending',
  closed: 'statusClosed',
};

function BrandMark() {
  // Same 3x3 board fragment as the favicon, so the tab and the header agree.
  return (
    <svg className={styles['mark']} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <g fill="currentColor" opacity="0.35">
        <rect x="1" y="1" width="8" height="8" rx="1" />
        <rect x="12" y="1" width="8" height="8" rx="1" />
        <rect x="23" y="1" width="8" height="8" rx="1" />
        <rect x="1" y="12" width="8" height="8" rx="1" />
        <rect x="23" y="12" width="8" height="8" rx="1" />
        <rect x="1" y="23" width="8" height="8" rx="1" />
        <rect x="12" y="23" width="8" height="8" rx="1" />
        <rect x="23" y="23" width="8" height="8" rx="1" />
      </g>
      <rect x="12" y="12" width="8" height="8" rx="1" fill="var(--accent)" />
    </svg>
  );
}

export interface AppBarProps {
  /** Online session summary; null when playing offline. */
  online: { status: NetStatus; code: string | null; peerConnected: boolean; playing: boolean } | null;
  onLeaveOnline: () => void;
  /** Hotseat controls — only meaningful with a local game in progress. */
  hotseat: {
    controllers: [Controller, Controller];
    onToggleAi: (seat: 0 | 1, ai: boolean) => void;
    onNewGame: () => void;
    aiThinking: boolean;
    activeSeat: 0 | 1;
  } | null;
  onOpenSettings: () => void;
}

export function AppBar({ online, onLeaveOnline, hotseat, onOpenSettings }: AppBarProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  // Escape closes the sheet, and body scroll is locked while it is open.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false);
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [menuOpen]);

  const links = NAV_ITEMS.map((item) => (
    <NavLink key={item.to} to={item.to} end={item.end} className={styles['navLink']} onClick={() => setMenuOpen(false)}>
      <Icon name={item.icon} size={14} />
      {item.label}
    </NavLink>
  ));

  return (
    <>
      <header className={styles['bar']}>
        <NavLink to="/" className={styles['brand']} aria-label="Terraforma — home">
          <BrandMark />
          <span className={styles['wordmark']}>Terraforma</span>
        </NavLink>

        <nav className={styles['nav']} aria-label="Main">
          {links}
        </nav>

        <div className={styles['rail']}>
          <div className={styles['railScroll']}>
            {online && (
              <>
                {online.code && <span className={styles['roomCode']}>{online.code}</span>}
                <span className={clsx(styles['status'], styles[STATUS_CLASS[online.status]])}>
                  <Icon name={online.status === 'open' ? 'connected' : 'disconnected'} size={12} />
                  {STATUS_TEXT[online.status]}
                </span>
                {!online.peerConnected && online.playing && (
                  <span className={styles['alert']}>
                    <Icon name="warning" size={12} />
                    Opponent disconnected
                  </span>
                )}
                <Button size="sm" onClick={onLeaveOnline}>
                  Leave
                </Button>
              </>
            )}

            {hotseat && (
              <>
                {hotseat.aiThinking && (
                  <span className={styles['thinking']}>
                    <span className={styles['pulse']} />
                    <Icon name="ai" size={12} />P{hotseat.activeSeat + 1} thinking
                  </span>
                )}
                {([0, 1] as const).map((p) => (
                  <label key={p} className={styles['seatToggle']}>
                    <input
                      type="checkbox"
                      checked={hotseat.controllers[p] === 'ai'}
                      onChange={(e) => hotseat.onToggleAi(p, e.target.checked)}
                    />
                    P{p + 1} AI
                  </label>
                ))}
                <Button size="sm" onClick={hotseat.onNewGame}>
                  New game
                </Button>
              </>
            )}
          </div>

          <Button size="sm" variant="ghost" onClick={onOpenSettings} aria-label="Settings">
            <Icon name="settings" size={16} />
          </Button>

          <Button
            size="sm"
            variant="ghost"
            className={styles['menuButton']}
            onClick={() => setMenuOpen(true)}
            aria-label="Open menu"
            aria-expanded={menuOpen}
          >
            <Icon name="menu" size={18} />
          </Button>
        </div>
      </header>

      {menuOpen && (
        <div className={styles['sheet']} role="dialog" aria-modal="true" aria-label="Menu">
          <div className={styles['sheetHead']}>
            <span className={styles['wordmark']}>Terraforma</span>
            <Button size="sm" variant="ghost" onClick={() => setMenuOpen(false)} aria-label="Close menu">
              <Icon name="close" size={18} />
            </Button>
          </div>
          <nav className={styles['sheetNav']} aria-label="Main">
            {links}
          </nav>
        </div>
      )}
    </>
  );
}
