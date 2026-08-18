import type { PlayerId } from '../engine';
import type { ClientMsg, ServerMsg } from './protocol';
import { wsUrl } from './protocol';

export type NetStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface NetSession {
  code: string;
  seat: PlayerId;
  token: string;
}

/**
 * WebSocket client for the relay server.
 *
 * Owns the connection lifecycle: the `hello` message (create/join/rejoin) is
 * (re)sent on every open, and once the server assigns a seat the hello is
 * upgraded to a `rejoin` so reconnects after a drop reclaim the same seat.
 * Outgoing messages queue while the socket is down.
 */
export class NetClient {
  private ws: WebSocket | null = null;
  private hello: ClientMsg | null = null;
  private session: NetSession | null = null;
  private queue: ClientMsg[] = [];
  private retryMs = 1000;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private closedByUser = false;

  constructor(
    private onMsg: (m: ServerMsg) => void,
    private onStatus: (s: NetStatus) => void,
  ) {}

  /** Open the connection with a create/join/rejoin hello. */
  connect(hello: ClientMsg): void {
    this.hello = hello;
    if (hello.t === 'rejoin') this.session = { code: hello.code, seat: hello.seat, token: hello.token };
    this.closedByUser = false;
    this.open('connecting');
  }

  /** Send now, or queue until the socket is open again. */
  send(msg: ClientMsg): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else if (!this.closedByUser) {
      this.queue.push(msg);
    }
  }

  /** User-initiated shutdown: no reconnect. */
  close(): void {
    this.closedByUser = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.queue = [];
    this.ws?.close();
    this.ws = null;
    this.onStatus('closed');
  }

  private open(status: NetStatus): void {
    this.onStatus(status);
    const stale = this.ws;
    const ws = new WebSocket(wsUrl());
    this.ws = ws;
    // A stale socket's handlers see ws !== this.ws and become no-ops.
    try {
      stale?.close();
    } catch {
      /* ignore */
    }

    ws.onopen = () => {
      if (ws !== this.ws) return;
      this.retryMs = 1000;
      this.onStatus('open');
      // Reclaim our seat if we have one, otherwise the original hello.
      const hello: ClientMsg | null = this.session ? { t: 'rejoin', ...this.session } : this.hello;
      if (hello) ws.send(JSON.stringify(hello));
      for (const m of this.queue.splice(0)) ws.send(JSON.stringify(m));
    };

    ws.onmessage = (ev) => {
      if (ws !== this.ws) return;
      let msg: ServerMsg;
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (msg.t === 'created' || msg.t === 'joined') {
        this.session = { code: msg.code, seat: msg.seat, token: msg.token };
      }
      this.onMsg(msg);
    };

    ws.onclose = () => {
      if (ws !== this.ws || this.closedByUser) return;
      this.retryTimer = setTimeout(() => this.open('reconnecting'), this.retryMs);
      this.retryMs = Math.min(this.retryMs * 2, 10_000);
      this.onStatus('reconnecting');
    };
  }
}
