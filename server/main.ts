/**
 * Online-play relay server: static hosting for the built app + the /ws relay.
 *
 * Dev:  npm run server   (Vite on 5173 proxies /ws here)
 * Prod: npm run build && npm start   (one process serves dist/ and /ws)
 *
 * Runs as TypeScript directly via Node >= 24 type-stripping.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import type { ClientMsg } from '../src/net/protocol.ts';
import { RoomManager, type Conn } from './rooms.ts';

const PORT = Number(process.env.PORT ?? 8787);
const DIST = resolve(import.meta.dirname, '../dist');

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
  '.woff2': 'font/woff2',
};

const httpServer = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    let file = normalize(join(DIST, url.pathname));
    if (!file.startsWith(DIST)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    if (!(await stat(file).catch(() => null))?.isFile()) {
      // SPA fallback so /?room=CODE (and any client route) serves the app.
      file = join(DIST, 'index.html');
    }
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found. In development, run "npm run dev" and open the Vite URL; this port only serves dist/ + /ws.');
  }
});

const manager = new RoomManager();
const wss = new WebSocketServer({ server: httpServer, path: '/ws', maxPayload: 1_000_000 });

interface Session {
  code: string;
  seat: 0 | 1;
}

wss.on('connection', (ws: WebSocket & { isAlive?: boolean }) => {
  let session: Session | null = null;
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));

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
    if (session) manager.disconnect(session.code, session.seat);
  });
});

// Heartbeat: drop sockets that stop answering pings so seats free up for rejoin.
setInterval(() => {
  for (const ws of wss.clients as Set<WebSocket & { isAlive?: boolean }>) {
    if (ws.isAlive === false) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 30_000);

setInterval(() => {
  for (const code of manager.sweep()) console.log(`[rooms] closed idle room ${code}`);
}, 60_000);

httpServer.listen(PORT, () => {
  console.log(`Terraforma relay listening on http://localhost:${PORT} (ws: /ws, static: dist/)`);
});
