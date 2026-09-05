/**
 * Online-play relay server: static hosting for the built app + the /ws relay.
 *
 * Dev:  npm run server   (Vite on 5173 proxies /ws here)
 * Prod: npm run build && npm start   (one process serves dist/ and /ws)
 *
 * Runs as TypeScript directly via Node type-stripping. The `--import
 * ./scripts/register-ts-ext.mjs` flag in the `server`/`start` scripts is what lets this
 * resolve the engine's extensionless relative imports; without it, `./engine.ts` fails.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { WebSocketServer, type WebSocket } from 'ws';
import type { ClientMsg } from '../src/net/protocol.ts';
import { RoomManager, type Conn } from './rooms.ts';
import { MemoryRoomStore, type RoomStore } from './store.ts';
import { changedRules } from './engine.ts';

const PORT = Number(process.env.PORT ?? 8787);
const DIST = resolve(import.meta.dirname, '../dist');

/**
 * RULES is process-global mutable state that the experiments workbench sweeps. A server that
 * validates or owns games must never be on an experimental ruleset — two clients on the
 * shipping build would silently disagree with it. Fail at boot, loudly, not at move 40.
 */
const drifted = changedRules();
if (drifted.length) {
  throw new Error(`Refusing to start on a non-shipping ruleset. Changed RULES: ${drifted.join(', ')}`);
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
  '.woff2': 'font/woff2',
};

/** Worth gzipping. WebP/woff2/avif are already compressed — re-compressing them costs CPU and grows bytes. */
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.svg', '.map']);

/**
 * Prefixes served as real files. A miss under one of these is a 404, NOT the SPA fallback:
 * a typo'd asset answering 200 with index.html is invisible in the browser, and any CDN in
 * front will happily cache HTML under a .webp URL.
 */
const ASSET_PREFIXES = ['/assets/', '/terrain/', '/card-art/', '/fonts/'];

/** Vite content-hashes everything under /assets/, so those are safe to pin forever. */
const IMMUTABLE = 'public, max-age=31536000, immutable';
/** public/ filenames are stable but NOT hashed — a day is a fair trade for regeneration. */
const STATIC = 'public, max-age=86400';

const SECURITY_HEADERS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'content-security-policy': "frame-ancestors 'none'",
};

/**
 * Compressed bodies for text assets, filled lazily and never evicted. Bounded in practice:
 * dist/ holds a handful of JS/CSS/JSON files (~700 KB raw), and the image tree — the actual
 * bulk — is not compressible so never lands here.
 */
const gzipCache = new Map<string, Uint8Array>();

function cacheControl(pathname: string): string {
  if (pathname.startsWith('/assets/')) return IMMUTABLE;
  // index.html names the hashed bundles, so it must never be held: a stale one pins a whole
  // stale app. Everything else in public/ gets the ordinary static policy.
  return pathname === '/' || pathname.endsWith('.html') ? 'no-cache' : STATIC;
}

const httpServer = createServer(async (req, res) => {
  const method = req.method ?? 'GET';
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    if (url.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      // `degraded` means writes are failing: games still play, but they stop being durable.
      // Surfacing it here is what turns that from a silent regression into an alert.
      res.end(
        JSON.stringify({
          ok: true,
          rooms: manager.size,
          durable: !store.degraded,
          uptime: Math.round(process.uptime()),
        }),
      );
      return;
    }

    if (method !== 'GET' && method !== 'HEAD') {
      res.writeHead(405, { allow: 'GET, HEAD', 'content-type': 'text/plain' }).end('Method not allowed');
      return;
    }

    let file = normalize(join(DIST, url.pathname));
    if (!file.startsWith(DIST)) {
      res.writeHead(403).end('Forbidden');
      return;
    }

    let pathname = url.pathname;
    if (!(await stat(file).catch(() => null))?.isFile()) {
      if (ASSET_PREFIXES.some((p) => pathname.startsWith(p))) {
        res.writeHead(404, { 'content-type': 'text/plain', 'cache-control': 'no-store' }).end('Not found');
        return;
      }
      // SPA fallback so /?room=CODE (and any client route) serves the app.
      file = join(DIST, 'index.html');
      pathname = '/index.html';
    }

    const ext = extname(file);
    const headers: Record<string, string> = {
      ...SECURITY_HEADERS,
      'content-type': CONTENT_TYPES[ext] ?? 'application/octet-stream',
      'cache-control': cacheControl(pathname),
    };

    const raw = await readFile(file);
    const wantsGzip = (req.headers['accept-encoding'] ?? '').includes('gzip');
    let body: Uint8Array = raw;
    if (wantsGzip && COMPRESSIBLE.has(ext)) {
      let hit = gzipCache.get(file);
      if (!hit) {
        hit = gzipSync(raw);
        gzipCache.set(file, hit);
      }
      body = hit;
      headers['content-encoding'] = 'gzip';
      headers['vary'] = 'accept-encoding';
    }

    headers['content-length'] = String(body.byteLength);
    res.writeHead(200, headers);
    // A HEAD must carry the same headers as its GET but no body.
    res.end(method === 'HEAD' ? undefined : body);
  } catch (e) {
    console.error(`[http] ${method} ${req.url} failed:`, e);
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found. In development, run "npm run dev" and open the Vite URL; this port only serves dist/ + /ws.');
  }
});

/**
 * No DATABASE_URL means in-memory rooms — exactly the pre-Phase-1 behaviour, and what keeps
 * `npm run server` zero-config for local play. The Postgres store is loaded dynamically so a
 * dev machine never has to resolve `pg` at all.
 */
const store: RoomStore = process.env.DATABASE_URL
  ? await (await import('./db/pgStore.ts')).createPgStore(process.env.DATABASE_URL)
  : new MemoryRoomStore();

const manager = new RoomManager(store);
const wss = new WebSocketServer({ noServer: true, maxPayload: 1_000_000 });

// --- Abuse limits -----------------------------------------------------------------------
// None of this existed while the relay only ran on a LAN. On the open internet the room map
// is unbounded memory reachable by anyone, so each limit below closes one cheap exhaustion
// path. They are deliberately generous: a real playtest session must never hit one.

const MAX_ROOMS = Number(process.env.MAX_ROOMS ?? 500);
const MAX_SOCKETS_PER_IP = Number(process.env.MAX_SOCKETS_PER_IP ?? 12);
const MAX_CREATES_PER_IP_PER_HOUR = Number(process.env.MAX_CREATES_PER_IP ?? 40);

const socketsPerIp = new Map<string, number>();
const createLog = new Map<string, number[]>();

function clientIp(req: { headers: Record<string, unknown>; socket: { remoteAddress?: string } }): string {
  // Render/Railway terminate TLS upstream, so the peer address is the proxy. Trust the first
  // XFF hop only because the platform appends it; direct-to-internet deploys should not.
  const xff = req.headers['x-forwarded-for'];
  const first = typeof xff === 'string' ? xff.split(',')[0]?.trim() : undefined;
  return first || req.socket.remoteAddress || 'unknown';
}

function mayCreateRoom(ip: string): boolean {
  if (manager.size >= MAX_ROOMS) return false;
  const now = Date.now();
  const recent = (createLog.get(ip) ?? []).filter((t) => now - t < 3_600_000);
  if (recent.length >= MAX_CREATES_PER_IP_PER_HOUR) {
    createLog.set(ip, recent);
    return false;
  }
  recent.push(now);
  createLog.set(ip, recent);
  return true;
}

/**
 * Same-origin check on the upgrade. The client only ever connects from the page the server
 * itself served (`wsUrl()` builds ws://<this host>/ws), so a mismatched Origin is either a
 * misconfigured proxy or a cross-site socket, and neither should get a room.
 * A missing Origin is allowed: non-browser clients (health probes, tests) send none.
 */
function originAllowed(origin: string | undefined, host: string | undefined): boolean {
  if (!origin) return true;
  if (process.env.ALLOWED_ORIGIN) return origin === process.env.ALLOWED_ORIGIN;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

httpServer.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  if (url.pathname !== '/ws') {
    socket.destroy();
    return;
  }
  if (!originAllowed(req.headers.origin, req.headers.host)) {
    console.warn(`[ws] rejected upgrade from origin ${req.headers.origin}`);
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }
  const ip = clientIp(req as never);
  if ((socketsPerIp.get(ip) ?? 0) >= MAX_SOCKETS_PER_IP) {
    socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req, ip));
});

interface Session {
  code: string;
  seat: 0 | 1;
}

wss.on('connection', (ws: WebSocket & { isAlive?: boolean }, _req: unknown, ip: string) => {
  let session: Session | null = null;
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));
  socketsPerIp.set(ip, (socketsPerIp.get(ip) ?? 0) + 1);

  const conn: Conn = {
    send: (msg) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
    },
    close: () => ws.close(),
  };

  ws.on('message', (raw) => {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(String(raw));
      if (typeof msg?.t !== 'string') throw new Error('missing t');
    } catch {
      conn.send({ t: 'error', code: 'bad-msg', message: 'Messages must be JSON with a "t" field.' });
      return;
    }
    if (msg.t === 'create') {
      if (!mayCreateRoom(ip)) {
        conn.send({ t: 'error', code: 'bad-msg', message: 'Too many rooms opened. Try again later.' });
        return;
      }
      session = manager.create(conn);
    } else if (msg.t === 'join') {
      session = manager.join(msg.code.toUpperCase(), conn) ?? session;
    } else if (msg.t === 'rejoin') {
      session = manager.rejoin(msg.code.toUpperCase(), msg.seat, msg.token, conn) ?? session;
    } else if (session) {
      manager.handle(session.code, session.seat, msg);
    } else {
      conn.send({ t: 'error', code: 'bad-msg', message: 'Join or create a room first.' });
    }
  });

  ws.on('close', () => {
    const n = (socketsPerIp.get(ip) ?? 1) - 1;
    if (n > 0) socketsPerIp.set(ip, n);
    else socketsPerIp.delete(ip);
    if (session) manager.disconnect(session.code, session.seat);
  });
});

// Heartbeat: drop sockets that stop answering pings so seats free up for rejoin.
const heartbeat = setInterval(() => {
  for (const ws of wss.clients as Set<WebSocket & { isAlive?: boolean }>) {
    if (ws.isAlive === false) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 30_000);

const sweeper = setInterval(() => {
  for (const code of manager.sweep()) console.log(`[rooms] closed idle room ${code}`);
  // Keep the rate-limit ledger from growing without bound on a long-lived process.
  const cutoff = Date.now() - 3_600_000;
  for (const [ip, times] of createLog) {
    const recent = times.filter((t) => t > cutoff);
    if (recent.length) createLog.set(ip, recent);
    else createLog.delete(ip);
  }
}, 60_000);

/**
 * A container stop is a routine event on a PaaS. Tell players why their room vanished rather
 * than dropping the sockets and letting them watch a silent reconnect loop.
 */
let shuttingDown = false;
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[server] ${sig} — closing ${wss.clients.size} socket(s)`);
    clearInterval(heartbeat);
    clearInterval(sweeper);
    manager.notifyShutdown('The server is restarting — reconnecting in a moment.');
    for (const ws of wss.clients) ws.close(1001, 'server shutting down');
    // Drain write-behind before exiting, or the tail of the action log dies with the process
    // and returning players lose their last few moves.
    void store.flush().then(() => httpServer.close(() => process.exit(0)));
    // Don't let a wedged socket hold the container open past the platform's grace period.
    setTimeout(() => process.exit(0), 5_000).unref();
  });
}

/**
 * ⚠ Rehydrate before listening, never after.
 *
 * A client whose socket dropped during the restart reconnects within 1-10s (NetClient backs
 * off exponentially) and sends `rejoin`. If that lands before the rooms are loaded it gets
 * `room-not-found`, which the client treats as terminal — discarding a game that was fully
 * recoverable. The gap is small and the failure is silent and permanent, which is the worst
 * combination, so pay the startup latency instead.
 */
const restored = await manager.rehydrate();
if (restored) console.log(`[rooms] rehydrated ${restored} room(s) from the store`);

httpServer.listen(PORT, () => {
  console.log(`Terraforma relay listening on http://localhost:${PORT} (ws: /ws, static: dist/)`);
});
