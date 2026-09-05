import { describe, expect, it } from 'vitest';
import {
  guestName,
  hashPassword,
  isGuest,
  mintSession,
  normalizeEmail,
  parseCookies,
  peekUser,
  readSession,
  SESSION_COOKIE,
  sessionCookie,
  validateCredentials,
  verifyPassword,
  resolveUser,
} from '../auth.ts';
import { MemoryUserStore } from '../users.ts';

const cookieFor = (token: string) => `${SESSION_COOKIE}=${encodeURIComponent(token)}`;

describe('session tokens', () => {
  it('round-trips a user id', () => {
    expect(readSession(mintSession('user-1'))).toBe('user-1');
  });

  it('rejects a tampered id', () => {
    const token = mintSession('user-1');
    // Swap the id but keep the signature: the whole point is that this cannot pass.
    const forged = token.replace('user-1', 'user-2');
    expect(readSession(forged)).toBeNull();
  });

  it('rejects a tampered expiry', () => {
    const token = mintSession('user-1');
    const [id, exp, sig] = token.split('.');
    expect(readSession(`${id}.${Number(exp) + 1_000_000}.${sig}`)).toBeNull();
  });

  it('rejects an expired token', () => {
    const token = mintSession('user-1', Date.now() - 400 * 24 * 60 * 60 * 1000);
    expect(readSession(token)).toBeNull();
  });

  it('rejects junk without throwing', () => {
    // timingSafeEqual throws on a length mismatch, so these must be length-checked first.
    for (const junk of ['', 'x', 'a.b', 'a.b.c', '...', 'a'.repeat(500)]) {
      expect(readSession(junk)).toBeNull();
    }
  });
});

describe('cookies', () => {
  it('parses a cookie header', () => {
    expect(parseCookies('a=1; tf_session=abc; b=2')).toMatchObject({ a: '1', tf_session: 'abc', b: '2' });
  });

  it('survives a malformed header', () => {
    expect(parseCookies(undefined)).toEqual({});
    expect(parseCookies('novalue; =empty; ok=1')).toEqual({ ok: '1' });
  });

  it('is httpOnly and SameSite=Lax, so script cannot read it and CSRF cannot ride it', () => {
    const c = sessionCookie('tok', 1000);
    expect(c).toContain('HttpOnly');
    expect(c).toContain('SameSite=Lax');
  });
});

describe('passwords', () => {
  it('verifies a correct password and rejects a wrong one', async () => {
    const hash = await hashPassword('correct horse battery');
    expect(await verifyPassword('correct horse battery', hash)).toBe(true);
    expect(await verifyPassword('wrong', hash)).toBe(false);
  });

  it('salts, so the same password hashes differently every time', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
  });

  it('rejects against a guest with no hash rather than throwing', async () => {
    expect(await verifyPassword('anything', null)).toBe(false);
    expect(await verifyPassword('anything', 'garbage')).toBe(false);
  });
});

describe('credential validation', () => {
  it('requires a plausible email and 8 characters', () => {
    expect(validateCredentials('a@b.co', 'longenough')).toBeNull();
    expect(validateCredentials('nope', 'longenough')).toMatch(/email/i);
    expect(validateCredentials('a@b.co', 'short')).toMatch(/8 characters/);
  });

  it('lowercases and trims emails, so casing cannot create a second account', () => {
    expect(normalizeEmail('  Jay@Example.COM ')).toBe('jay@example.com');
  });
});

describe('guest-first accounts', () => {
  it('mints a guest for a visitor with no cookie, and sets one', async () => {
    const users = new MemoryUserStore();
    const { user, setCookie } = await resolveUser(users, undefined);
    expect(isGuest(user)).toBe(true);
    expect(user.displayName).toMatch(/^Guest /);
    expect(setCookie).toContain(SESSION_COOKIE);
  });

  it('returns the same account on the next request, and sets no new cookie', async () => {
    const users = new MemoryUserStore();
    const first = await resolveUser(users, undefined);
    const again = await resolveUser(users, cookieFor(mintSession(first.user.id)));
    expect(again.user.id).toBe(first.user.id);
    expect(again.setCookie).toBeUndefined();
  });

  it('mints a fresh guest when a signed id has no row, rather than failing', async () => {
    // Happens if a user is deleted under a live cookie, or a memory store restarts.
    const users = new MemoryUserStore();
    const { user } = await resolveUser(users, cookieFor(mintSession('ghost')));
    expect(user.id).not.toBe('ghost');
    expect(isGuest(user)).toBe(true);
  });

  it('peekUser never creates anyone — the socket upgrade must not write', async () => {
    const users = new MemoryUserStore();
    expect(await peekUser(users, undefined)).toBeUndefined();
    expect(await peekUser(users, cookieFor(mintSession('nobody')))).toBeUndefined();
  });

  it('claiming keeps the same row, so nothing the guest did is orphaned', async () => {
    const users = new MemoryUserStore();
    const { user } = await resolveUser(users, undefined);
    await users.update(user.id, { email: 'a@b.co', passwordHash: await hashPassword('longenough'), displayName: 'Jay' });

    const claimed = await users.byId(user.id);
    expect(claimed?.id).toBe(user.id);
    expect(isGuest(claimed!)).toBe(false);
    expect(await users.byEmail('a@b.co')).toMatchObject({ id: user.id, displayName: 'Jay' });
  });

  it('generates readable guest names with no ambiguous characters', () => {
    for (let i = 0; i < 50; i++) expect(guestName()).toMatch(/^Guest [ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/);
  });
});
