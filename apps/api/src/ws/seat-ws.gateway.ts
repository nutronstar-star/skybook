import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import { z } from 'zod';
import { verifyAccessToken } from '../shared/security/jwt.js';
import { isSessionInvalidated, redis } from '../shared/redis/client.js';
import { logger } from '../shared/logger/pii-scrubber.js';
import {
  SEAT_EVENTS_CHANNEL,
  type SeatRealtimeEvent
} from '../modules/booking/index.js';

const HANDSHAKE_AUTH_TIMEOUT_MS = 5000; // EI-07: 5s handshake window
const MAX_MESSAGES_PER_MINUTE = 60;     // EI-07: 60 msg/min rate limit

const ClientInboundMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('AUTH'),
    token: z.string().min(10),
    flightId: z.string().uuid().optional()
  }),
  z.object({
    type: z.literal('SUBSCRIBE'),
    flightId: z.string().uuid()
  }),
  z.object({
    type: z.literal('UNSUBSCRIBE'),
    flightId: z.string().uuid()
  }),
  z.object({
    type: z.literal('PING')
  })
]);

interface ClientConnectionState {
  authenticated: boolean;
  userId?: string;
  sessionId?: string;
  flightId?: string;
  msgWindowStartMs: number;
  msgCountInWindow: number;
  authTimer: NodeJS.Timeout;
}

export class SeatWebSocketGateway {
  private readonly wss: WebSocketServer;
  private readonly subscriber = redis.duplicate();
  private readonly rooms = new Map<string, Set<WebSocket>>();
  private readonly clients = new Map<WebSocket, ClientConnectionState>();
  private attachedServer: Server | null = null;
  private isClosed = false;

  constructor(private readonly handshakeTimeoutMs = HANDSHAKE_AUTH_TIMEOUT_MS) {
    this.wss = new WebSocketServer({ noServer: true });
    this.setupWebSocketHandlers();
    this.setupRedisSubscriber();
  }

  private setupRedisSubscriber(): void {
    this.subscriber.on('error', (err: Error) => {
      logger.error({ err: err.message }, 'WebSocket Redis subscriber error');
    });

    void this.subscriber.subscribe(SEAT_EVENTS_CHANNEL).catch((err: Error) => {
      logger.error({ err: err.message }, 'Failed to subscribe to seat events channel');
    });

    this.subscriber.on('message', (channel: string, rawMessage: string) => {
      if (channel !== SEAT_EVENTS_CHANNEL) return;
      try {
        const event = JSON.parse(rawMessage) as SeatRealtimeEvent;
        this.broadcastToFlight(event.flightId, event);
      } catch {
        // Ignore malformed pub/sub messages
      }
    });
  }

  private subscribeSocketToFlight(ws: WebSocket, state: ClientConnectionState, flightId: string): void {
    if (state.flightId && state.flightId !== flightId) {
      this.unsubscribeSocketFromFlight(ws, state.flightId);
    }
    state.flightId = flightId;
    let room = this.rooms.get(flightId);
    if (!room) {
      room = new Set();
      this.rooms.set(flightId, room);
    }
    room.add(ws);
  }

  private unsubscribeSocketFromFlight(ws: WebSocket, flightId: string): void {
    const room = this.rooms.get(flightId);
    if (!room) return;
    room.delete(ws);
    if (room.size === 0) {
      this.rooms.delete(flightId);
    }
  }

  private sendJson(ws: WebSocket, payload: unknown): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }

  private setupWebSocketHandlers(): void {
    this.wss.on('connection', (ws: WebSocket) => {
      // EI-07: Enforce JWT in first message within 5s handshake timeout
      const authTimer = setTimeout(() => {
        const current = this.clients.get(ws);
        if (current && !current.authenticated) {
          this.sendJson(ws, {
            type: 'ERROR',
            code: 'AUTH_TIMEOUT',
            message: 'First message must be AUTH with a valid JWT within 5 seconds'
          });
          ws.close(4001, 'AUTH_TIMEOUT');
        }
      }, this.handshakeTimeoutMs);

      const state: ClientConnectionState = {
        authenticated: false,
        msgWindowStartMs: Date.now(),
        msgCountInWindow: 0,
        authTimer
      };
      this.clients.set(ws, state);

      ws.on('message', (raw: RawData) => {
        void this.handleClientMessage(ws, state, raw);
      });

      ws.on('close', () => {
        clearTimeout(state.authTimer);
        if (state.flightId) {
          this.unsubscribeSocketFromFlight(ws, state.flightId);
        }
        this.clients.delete(ws);
      });

      ws.on('error', () => {
        clearTimeout(state.authTimer);
        if (state.flightId) {
          this.unsubscribeSocketFromFlight(ws, state.flightId);
        }
        this.clients.delete(ws);
      });
    });
  }

  private async handleClientMessage(
    ws: WebSocket,
    state: ClientConnectionState,
    raw: RawData
  ): Promise<void> {
    // Sliding 60-second message rate limit (EI-07: 60 msg/min)
    const now = Date.now();
    if (now - state.msgWindowStartMs >= 60_000) {
      state.msgWindowStartMs = now;
      state.msgCountInWindow = 0;
    }
    state.msgCountInWindow += 1;
    if (state.msgCountInWindow > MAX_MESSAGES_PER_MINUTE) {
      this.sendJson(ws, {
        type: 'ERROR',
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Maximum 60 WebSocket messages per minute exceeded'
      });
      ws.close(4008, 'RATE_LIMIT_EXCEEDED');
      return;
    }

    let parsedJson: unknown;
    try {
      const text = typeof raw === 'string' ? raw : raw.toString('utf8');
      parsedJson = JSON.parse(text);
    } catch {
      this.sendJson(ws, {
        type: 'ERROR',
        code: 'VALIDATION_ERROR',
        message: 'WebSocket frame must be valid JSON'
      });
      if (!state.authenticated) {
        ws.close(4002, 'INVALID_FIRST_MESSAGE');
      }
      return;
    }

    const parsed = ClientInboundMessageSchema.safeParse(parsedJson);
    if (!parsed.success) {
      this.sendJson(ws, {
        type: 'ERROR',
        code: 'VALIDATION_ERROR',
        message: 'Invalid WebSocket message schema'
      });
      if (!state.authenticated) {
        ws.close(4002, 'INVALID_FIRST_MESSAGE');
      }
      return;
    }

    const msg = parsed.data;

    // First message MUST be AUTH with valid JWT (EI-07)
    if (!state.authenticated) {
      if (msg.type !== 'AUTH') {
        this.sendJson(ws, {
          type: 'ERROR',
          code: 'UNAUTHORIZED',
          message: 'First message must be AUTH with a valid JWT'
        });
        ws.close(4003, 'UNAUTHORIZED');
        return;
      }

      try {
        const claims = await verifyAccessToken(msg.token);
        const revoked = await isSessionInvalidated(claims.sid, claims.sub, claims.iat);
        if (revoked) {
          throw new Error('Session revoked');
        }

        clearTimeout(state.authTimer);
        state.authenticated = true;
        state.userId = claims.sub;
        state.sessionId = claims.sid;

        if (msg.flightId) {
          this.subscribeSocketToFlight(ws, state, msg.flightId);
        }

        this.sendJson(ws, {
          type: 'AUTH_OK',
          userId: claims.sub,
          ...(msg.flightId ? { flightId: msg.flightId } : {})
        });
      } catch {
        this.sendJson(ws, {
          type: 'ERROR',
          code: 'UNAUTHORIZED',
          message: 'Invalid or expired JWT'
        });
        ws.close(4003, 'INVALID_TOKEN');
      }
      return;
    }

    if (msg.type === 'SUBSCRIBE') {
      this.subscribeSocketToFlight(ws, state, msg.flightId);
      this.sendJson(ws, { type: 'SUBSCRIBED', flightId: msg.flightId });
      return;
    }

    if (msg.type === 'UNSUBSCRIBE') {
      this.unsubscribeSocketFromFlight(ws, msg.flightId);
      if (state.flightId === msg.flightId) {
        state.flightId = undefined;
      }
      this.sendJson(ws, { type: 'UNSUBSCRIBED', flightId: msg.flightId });
      return;
    }

    if (msg.type === 'PING') {
      this.sendJson(ws, { type: 'PONG', timestamp: new Date().toISOString() });
    }
  }

  public broadcastToFlight(flightId: string, event: SeatRealtimeEvent): void {
    const room = this.rooms.get(flightId);
    if (!room || room.size === 0) return;

    const payload = JSON.stringify(event);
    for (const client of room) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }

  public attach(server: Server): void {
    if (this.attachedServer === server) return;
    this.attachedServer = server;

    server.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
      const urlPath = (request.url ?? '').split('?')[0];
      if (urlPath !== '/v1/ws/seats') {
        socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
        socket.destroy();
        return;
      }

      this.wss.handleUpgrade(request, socket, head, (ws) => {
        this.wss.emit('connection', ws, request);
      });
    });
  }

  public async close(): Promise<void> {
    if (this.isClosed) return;
    this.isClosed = true;

    for (const [ws, state] of this.clients.entries()) {
      clearTimeout(state.authTimer);
      ws.close(1001, 'SERVER_SHUTDOWN');
    }
    this.clients.clear();
    this.rooms.clear();

    await new Promise<void>((resolve) => {
      this.wss.close(() => resolve());
    });

    try {
      await this.subscriber.quit();
    } catch {
      this.subscriber.disconnect();
    }
  }
}