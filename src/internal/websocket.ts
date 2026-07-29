import { LiveRoomSdkError } from '../errors.js';
import type { LiveRoomLogger, RoomSnapshot } from '../types.js';
import type { LiveRoomRuntime, WebSocketLike } from './runtime.js';

export interface ViewerWebSocketCredential {
  url: string;
  ticket: string;
}

export interface ViewerWebSocketCallbacks {
  onReady(online: number | null): void;
  onOnlineChanged(online: number | null): void;
  onRoomStatusChanged(status: string): void;
  onError(error: Error): void;
  onReconnecting(): void;
}

interface MessageEventLike {
  data?: string;
}

interface CloseEventLike {
  code?: number;
}

export class ViewerWebSocketTransport {
  private socket: WebSocketLike | null = null;
  private connectPromise: Promise<void> | null = null;
  private closed = false;
  private socketGeneration = 0;
  private reconnectAttempts = 0;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private detachSocketListeners: (() => void) | null = null;

  constructor(
    private readonly runtime: LiveRoomRuntime,
    private readonly getCredential: () => Promise<ViewerWebSocketCredential>,
    private readonly callbacks: ViewerWebSocketCallbacks,
    private readonly room: RoomSnapshot,
    private readonly logger?: LiveRoomLogger
  ) {}

  open(): Promise<void> {
    if (this.closed) {
      return Promise.reject(
        new LiveRoomSdkError({
          code: 'SDK_CLOSED',
          message: 'The SDK has already been closed.'
        })
      );
    }

    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.connectPromise = this.connectNextSocket();
    return this.connectPromise;
  }

  async close(): Promise<void> {
    this.closed = true;
    this.connectPromise = null;
    this.stopHeartbeat();
    this.clearReconnectTimer();
    this.socketGeneration += 1;
    this.detachSocketListeners?.();
    this.detachSocketListeners = null;

    const currentSocket = this.socket;
    this.socket = null;
    currentSocket?.close(1000, 'sdk.close');
  }

  private async connectNextSocket(): Promise<void> {
    const credential = await this.getCredential();
    const generation = ++this.socketGeneration;
    const socket = this.runtime.createWebSocket(credential.url);
    this.socket = socket;

    await new Promise<void>((resolve, reject) => {
      let resolved = false;

      const cleanup = () => {
        socket.removeEventListener('open', handleOpen as EventListener);
        socket.removeEventListener('message', handleMessage as EventListener);
        socket.removeEventListener('close', handleClose as EventListener);
        socket.removeEventListener('error', handleError as EventListener);
        if (this.detachSocketListeners === cleanup) {
          this.detachSocketListeners = null;
        }
      };
      this.detachSocketListeners?.();
      this.detachSocketListeners = cleanup;

      const fail = (error: Error) => {
        if (resolved) {
          return;
        }
        resolved = true;
        cleanup();
        reject(error);
      };

      const succeed = () => {
        if (resolved) {
          return;
        }
        resolved = true;
        this.reconnectAttempts = 0;
        resolve();
      };

      const handleOpen = () => {
        if (generation !== this.socketGeneration || this.closed) {
          return;
        }

        socket.send(
          JSON.stringify({
            type: 'room.auth',
            ticket: credential.ticket,
            protocol_version: '1.0'
          })
        );
      };

      const handleMessage = (event: MessageEventLike) => {
        if (generation !== this.socketGeneration || this.closed) {
          return;
        }

        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(String(event.data ?? '{}')) as Record<string, unknown>;
        } catch (error) {
          this.logger?.warn?.('Discarded invalid websocket payload', {
            error: error instanceof Error ? error.message : String(error)
          });
          return;
        }

        switch (payload.type) {
          case 'room.ready': {
            const heartbeatInterval = typeof payload.heartbeat_interval === 'number' ? payload.heartbeat_interval : 15;
            const room = (payload.room ?? {}) as Record<string, unknown>;
            const online = typeof room.online === 'number' ? room.online : null;
            this.callbacks.onReady(online);
            this.startHeartbeat(heartbeatInterval, generation);
            succeed();
            return;
          }
          case 'room.online.changed':
            this.callbacks.onOnlineChanged(typeof payload.online === 'number' ? payload.online : null);
            return;
          case 'room.status.changed':
            if (typeof payload.status === 'string') {
              this.room.status = payload.status;
              this.callbacks.onRoomStatusChanged(payload.status);
            }
            return;
          case 'room.kicked':
            {
              const error = new LiveRoomSdkError({
                code: 'WEBSOCKET_AUTH_FAILED',
                message: 'The room websocket session was revoked.'
              });
              this.closed = true;
              this.clearReconnectTimer();
              this.stopHeartbeat();
              if (this.socket === socket) {
                this.socket = null;
              }
              this.callbacks.onError(error);
              if (!resolved) {
                fail(error);
              } else {
                cleanup();
              }
            }
            socket.close(4001, 'kicked');
            return;
          case 'error':
            fail(
              new LiveRoomSdkError({
                code: 'WEBSOCKET_AUTH_FAILED',
                message: typeof payload.message === 'string' ? payload.message : 'Room websocket failed.'
              })
            );
            socket.close(4000, 'error');
            return;
          default:
            return;
        }
      };

      const handleError = () => {
        if (resolved) {
          return;
        }
        fail(
          new LiveRoomSdkError({
            code: 'WEBSOCKET_AUTH_FAILED',
            message: 'Failed to establish the room websocket.',
            retryable: true
          })
        );
      };

      const handleClose = (event: CloseEventLike) => {
        if (generation !== this.socketGeneration) {
          return;
        }

        cleanup();
        this.stopHeartbeat();
        this.socket = null;
        this.connectPromise = null;

        if (!resolved) {
          fail(
            new LiveRoomSdkError({
              code: 'WEBSOCKET_AUTH_FAILED',
              message: `Room websocket closed before ready (${event.code ?? 1006}).`,
              retryable: true
            })
          );
          return;
        }

        if (!this.closed) {
          this.callbacks.onReconnecting();
          this.scheduleReconnect();
        }
      };

      socket.addEventListener('open', handleOpen as EventListener);
      socket.addEventListener('message', handleMessage as EventListener);
      socket.addEventListener('close', handleClose as EventListener);
      socket.addEventListener('error', handleError as EventListener);
    }).catch((error) => {
      this.connectPromise = null;
      if (!this.closed) {
        this.callbacks.onReconnecting();
        this.scheduleReconnect();
      }
      throw error;
    });

    this.connectPromise = null;
  }

  private startHeartbeat(intervalSeconds: number, generation: number): void {
    this.stopHeartbeat();
    this.heartbeatTimer = this.runtime.setInterval(() => {
      if (generation !== this.socketGeneration || this.closed || !this.socket) {
        return;
      }

      this.socket.send(JSON.stringify({ type: 'room.heartbeat' }));
    }, Math.max(intervalSeconds, 1) * 1000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      this.runtime.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect(): void {
    this.clearReconnectTimer();
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 15000);
    this.reconnectAttempts += 1;
    this.reconnectTimer = this.runtime.setTimeout(() => {
      this.reconnectTimer = null;
      if (this.closed) {
        return;
      }
      void this.open().catch((error) => {
        this.callbacks.onError(error as Error);
      });
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      this.runtime.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
