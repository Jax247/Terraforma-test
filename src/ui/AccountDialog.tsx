/**
 * Account dialog: claim a guest account, or sign in to an existing one.
 *
 * Framed around "keep your decks" rather than "sign up", because that is the only thing an
 * account actually buys here — a guest can already play, share invite links, and be seated by
 * name. There is nothing to gate, so nothing here nags.
 */
import { useState } from 'react';
import { Button } from './components/Button';
import { Modal } from './Modal';
import type { Auth } from './online/useAuth';
import styles from './AccountDialog.module.scss';

type Mode = 'claim' | 'login';

export function AccountDialog({ auth, onClose }: { auth: Auth; onClose: () => void }) {
  const { me } = auth;
  const [mode, setMode] = useState<Mode>('claim');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState(me?.guest ? '' : (me?.displayName ?? ''));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Already signed in: the only thing left to offer is the way out.
  if (me && !me.guest) {
    return (
      <Modal title="Account" onClose={onClose} top>
        <div className={styles['group']}>
          <div className={styles['groupTitle']}>Signed in</div>
          <p className={styles['groupNote']}>
            <strong>{me.displayName}</strong> — {me.email}
          </p>
          <p className={styles['groupNote']}>
            Your decks and boards follow this account to any browser you sign in from.
          </p>
          <Button
            variant="ghost"
            onClick={() => {
              void auth.logout().then(onClose);
            }}
          >
            Sign out
          </Button>
        </div>
      </Modal>
    );
  }

  const submit = () => {
    setBusy(true);
    setError('');
    const run = mode === 'claim' ? auth.claim(email, password, displayName) : auth.login(email, password);
    void run.then((err) => {
      setBusy(false);
      if (err) setError(err);
      else onClose();
    });
  };

  return (
    <Modal title={mode === 'claim' ? 'Keep your decks' : 'Sign in'} onClose={onClose} top>
      <div className={styles['group']}>
        <p className={styles['groupNote']}>
          {mode === 'claim' ? (
            <>
              You are playing as <strong>{me?.displayName ?? 'a guest'}</strong>. That works fine on this browser —
              an account is what carries it to another one. Nothing you have made is lost by adding one.
            </>
          ) : (
            <>Signing in replaces the guest you are using on this browser.</>
          )}
        </p>

        <form
          className={styles['form']}
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          {mode === 'claim' && (
            <label className={styles['field']}>
              <span>Display name</span>
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder={me?.displayName ?? ''}
                maxLength={40}
                autoComplete="nickname"
              />
            </label>
          )}
          <label className={styles['field']}>
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="username"
            />
          </label>
          <label className={styles['field']}>
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              autoComplete={mode === 'claim' ? 'new-password' : 'current-password'}
            />
          </label>

          {error && (
            <p className={styles['error']} role="alert">
              {error}
            </p>
          )}

          <div className={styles['actions']}>
            <Button type="submit" disabled={busy}>
              {busy ? 'Working…' : mode === 'claim' ? 'Create account' : 'Sign in'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setMode(mode === 'claim' ? 'login' : 'claim');
                setError('');
              }}
            >
              {mode === 'claim' ? 'I already have an account' : 'Create one instead'}
            </Button>
          </div>
        </form>
      </div>
    </Modal>
  );
}
