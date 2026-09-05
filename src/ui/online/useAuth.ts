/**
 * Account state for the client.
 *
 * Guest-first: /api/me mints an account for anyone who asks, so this resolves to a real
 * identity on first load with no signup screen and nothing to dismiss. `guest` is the only
 * flag the UI needs — it distinguishes "we know who you are on this device" from "this
 * identity follows you to other devices".
 *
 * The session is an httpOnly cookie, so there is deliberately nothing to store here and
 * nothing for script to read: every call just goes to the server with credentials attached.
 */
import { useCallback, useEffect, useState } from 'react';

export interface Me {
  id: string;
  displayName: string;
  email: string | null;
  guest: boolean;
}

export interface Auth {
  me: Me | undefined;
  /** True until the first /api/me settles, so the UI can avoid flashing "Sign in". */
  loading: boolean;
  /** Attach an email + password to the CURRENT account, keeping everything it already has. */
  claim: (email: string, password: string, displayName: string) => Promise<string | null>;
  login: (email: string, password: string) => Promise<string | null>;
  logout: () => Promise<void>;
}

async function post(path: string, body?: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, data };
}

export function useAuth(): Auth {
  const [me, setMe] = useState<Me | undefined>(undefined);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    void fetch('/api/me')
      .then((r) => (r.ok ? (r.json() as Promise<Me>) : undefined))
      .catch(() => undefined)
      .then((m) => {
        // A failure here is not fatal: the app still plays hotseat, and online play still
        // works anonymously. Leaving `me` undefined is the honest representation of that.
        if (live) {
          setMe(m);
          setLoading(false);
        }
      });
    return () => {
      live = false;
    };
  }, []);

  /** Returns an error message, or null on success. */
  const run = useCallback(async (path: string, body: unknown): Promise<string | null> => {
    try {
      const { ok, data } = await post(path, body);
      if (!ok) return typeof data['error'] === 'string' ? data['error'] : 'Something went wrong.';
      setMe(data as unknown as Me);
      return null;
    } catch {
      return 'Could not reach the server.';
    }
  }, []);

  const claim = useCallback(
    (email: string, password: string, displayName: string) =>
      run('/api/auth/claim', { email, password, displayName }),
    [run],
  );

  const login = useCallback((email: string, password: string) => run('/api/auth/login', { email, password }), [run]);

  const logout = useCallback(async () => {
    await post('/api/auth/logout').catch(() => undefined);
    // Pick up the fresh guest the server hands out, so the UI never sits in a signed-out
    // limbo that none of the online flows expect.
    const m = await fetch('/api/me')
      .then((r) => (r.ok ? (r.json() as Promise<Me>) : undefined))
      .catch(() => undefined);
    setMe(m);
  }, []);

  return { me, loading, claim, login, logout };
}
