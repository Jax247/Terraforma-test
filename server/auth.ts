/**
 * Guest-first identity.
 *
 * Everyone who touches the API gets an account immediately, with no email, no password and no
 * signup screen — which is what keeps "open the invite link and play" true. Claiming an
 * account later attaches credentials to that same row, so a guest never loses what they did
 * by signing up.
 *
 * Sessions are a SIGNED COOKIE, not a sessions table. The same reasoning as seat tokens in
 * rooms.ts: a value the server can verify from a secret needs no storage, survives a restart
 * for free, and puts no live credential in the database or its backups. The trade is that a
 * session cannot be revoked server-side before it expires — acceptable for a playtest build,
 * and the shape to revisit if this ever holds anything worth stealing.
 */
import { createHmac, randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { User, UserStore } from './users.ts';

const scrypt = promisify(scryptCb) as (pw: string, salt: string, len: number) => Promise<Buffer>;

export const SESSION_COOKIE = 'tf_session';
const SESSION_TTL_MS = 180 * 24 * 60 * 60 * 1000; // 180 days: a playtester should never be logged out mid-season.

const SESSION_SECRET =
  process.env.SESSION_SECRET ??
  (() => {
    if (process.env.NODE_ENV === 'production') {
      console.warn('[auth] SESSION_SECRET is unset in production — every restart logs everyone out.');
    }
    return randomBytes(32).toString('hex');
  })();

// --- cookies ---------------------------------------------------------------------------

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    if (k) out[k] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

/**
 * `secure` is conditional because a Secure cookie is silently dropped over plain http, which
 * would make local development look like a broken login rather than a missing TLS terminator.
 */
export function sessionCookie(value: string, maxAgeMs: number): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(maxAgeMs / 1000)}${secure}`;
}

export const clearCookie = (): string => sessionCookie('', 0);

// --- session tokens --------------------------------------------------------------------

/** `<userId>.<expiryMs>.<hmac>` — everything needed to trust it without a lookup. */
export function mintSession(userId: string, now = Date.now()): string {
  const exp = now + SESSION_TTL_MS;
  const body = `${userId}.${exp}`;
  return `${body}.${createHmac('sha256', SESSION_SECRET).update(body).digest('base64url')}`;
}

export function readSession(token: string | undefined, now = Date.now()): string | null {
  if (!token) return null;
  const cut = token.lastIndexOf('.');
  if (cut < 0) return null;
  const body = token.slice(0, cut);
  const want = Buffer.from(createHmac('sha256', SESSION_SECRET).update(body).digest('base64url'));
  const got = Buffer.from(token.slice(cut + 1));
  // timingSafeEqual throws on unequal lengths, so check that first.
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  const dot = body.lastIndexOf('.');
  if (dot < 0) return null;
  if (Number(body.slice(dot + 1)) < now) return null;
  return body.slice(0, dot);
}

// --- passwords -------------------------------------------------------------------------

/**
 * scrypt from node:crypto — no dependency, and memory-hard where a plain hash is not. Format
 * is `scrypt$<salt>$<key>` so the parameters travel with the hash and can be changed later
 * without invalidating anything.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt}$${key.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const [scheme, salt, key] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !key) return false;
  const want = Buffer.from(key, 'hex');
  const got = await scrypt(password, salt, want.length);
  return want.length === got.length && timingSafeEqual(want, got);
}

// --- accounts --------------------------------------------------------------------------

// No 0/O/1/I, same reasoning as room codes: these get read aloud across a table.
const NAME_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function guestName(): string {
  let s = '';
  for (let i = 0; i < 4; i++) s += NAME_ALPHABET[Math.floor(Math.random() * NAME_ALPHABET.length)];
  return `Guest ${s}`;
}

export const isGuest = (u: User): boolean => u.email === null;

/** Resolve the cookie to a user, creating a guest when there isn't one. */
export async function resolveUser(
  users: UserStore,
  cookieHeader: string | undefined,
): Promise<{ user: User; setCookie?: string }> {
  const id = readSession(parseCookies(cookieHeader)[SESSION_COOKIE]);
  if (id) {
    const found = await users.byId(id);
    // A signed id with no row is a user deleted out from under a live cookie, or a memory
    // store that restarted. Fall through and mint a fresh guest rather than 500.
    if (found) {
      users.touch(found.id);
      return { user: found };
    }
  }
  const user: User = { id: randomUUID(), email: null, passwordHash: null, displayName: guestName() };
  await users.create(user);
  return { user, setCookie: sessionCookie(mintSession(user.id), SESSION_TTL_MS) };
}

/** Read the cookie WITHOUT creating anyone. For the socket upgrade, which must not write. */
export async function peekUser(users: UserStore, cookieHeader: string | undefined): Promise<User | undefined> {
  const id = readSession(parseCookies(cookieHeader)[SESSION_COOKIE]);
  return id ? await users.byId(id) : undefined;
}

export const normalizeEmail = (e: string): string => e.trim().toLowerCase();

/** Shared by claim and login so the two can't drift apart. */
export function validateCredentials(email: string, password: string): string | null {
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalizeEmail(email))) return 'That does not look like an email address.';
  if (password.length < 8) return 'Use at least 8 characters.';
  if (password.length > 200) return 'That password is too long.';
  return null;
}
