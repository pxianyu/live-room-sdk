import { HttpClient } from './HttpClient.js';
import { LiveRoomState } from './LiveRoom.js';
import { LiveRoomUserState } from './User.js';
import { LiveRoomSdkError } from './errors.js';
import { connectGoEasy, type GoEasyConnection } from './internal/goeasy.js';
import { createDefaultRuntime, type LiveRoomRuntime } from './internal/runtime.js';
import { ViewerWebSocketTransport } from './internal/websocket.js';
import type {
  BootstrapResponse,
  LiveRoomLogger,
  LiveRoomSdk,
  LiveRoomSdkOptions,
  MediaSource,
  MessagePage,
  PendingMessage,
  RealtimeCredentialResponse,
  RoomCapability,
  RoomMessage,
  RoomSnapshot,
  SessionResponse
} from './types.js';

interface SessionState {
  sessionId: string;
  accessToken: string;
  expiresAt: number | undefined;
}

interface LiveRoomSdkRuntimeOptions {
  runtime?: LiveRoomRuntime;
}

function normalizeMediaSources(
  sources: Array<{ protocol: string; url: string; expires_at?: string }> | undefined
): readonly MediaSource[] {
  return (sources ?? []).map((source) => ({
    protocol: source.protocol,
    url: source.url,
    expiresAt: source.expires_at
  }));
}

function normalizeRoomSnapshot(bootstrap: BootstrapResponse): { snapshot: RoomSnapshot; sequence: number | null } {
  const playback = bootstrap.room.playback;
  return {
    snapshot: {
      id: bootstrap.room.id,
      title: bootstrap.room.title,
      status: bootstrap.room.status,
      muted: bootstrap.room.muted,
      notice: bootstrap.room.notice,
      features: bootstrap.room.features,
      playback: playback
        ? {
            mode: playback.mode,
            sources: normalizeMediaSources(playback.sources)
          }
        : undefined
    },
    sequence: bootstrap.room.current_sequence ?? bootstrap.room.sequence ?? null
  };
}

function isExpired(expiresAt: number | undefined, now: number): boolean {
  return typeof expiresAt === 'number' && expiresAt <= now + 5_000;
}

function parseExpiry(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const millis = Date.parse(value);
  return Number.isNaN(millis) ? undefined : millis;
}

function isMessageHistoryUnavailable(error: unknown): error is LiveRoomSdkError {
  return error instanceof LiveRoomSdkError && error.code === 'FEATURE_NOT_AVAILABLE' && error.status === 501;
}

export class LiveRoomSdkImpl implements LiveRoomSdk {
  readonly user = new LiveRoomUserState();
  readonly room: LiveRoomState;

  private readonly logger: LiveRoomLogger | undefined;
  private readonly runtime: LiveRoomRuntime;
  private readonly httpClient: HttpClient;
  private readonly authClient: HttpClient;

  private session: SessionState | null = null;
  private currentBootstrap: BootstrapResponse | null = null;
  private goeasyConnection: GoEasyConnection | null = null;
  private websocketTransport: ViewerWebSocketTransport | null = null;
  private closed = false;
  private connectFlight: Promise<void> | null = null;
  private refreshFlight: Promise<void> | null = null;
  private closeFlight: Promise<void> | null = null;

  constructor(
    private readonly options: LiveRoomSdkOptions,
    runtimeOptions: LiveRoomSdkRuntimeOptions = {}
  ) {
    this.logger = options.logger;
    this.runtime = runtimeOptions.runtime ?? createDefaultRuntime(options.fetch, this.logger);
    this.room = new LiveRoomState({
      connect: () => this.connect(),
      refresh: () => this.refresh(),
      close: () => this.close(),
      refreshInfo: () => this.refreshInfo(),
      refreshMedia: () => this.refreshMedia(),
      loadPreviousMessages: (cursor) => this.loadPreviousMessages(cursor),
      sendComment: (text) => this.sendComment(text),
      sendLike: (count) => this.sendLike(count),
      deleteComment: (messageId, reason) => this.deleteComment(messageId, reason),
      muteUser: (userId, durationSeconds) => this.muteUser(userId, durationSeconds),
      unmuteUser: (userId) => this.unmuteUser(userId),
      setRoomMute: (enabled) => this.setRoomMute(enabled)
    });
    this.authClient = new HttpClient({
      baseUrl: options.apiBaseUrl,
      fetch: this.runtime.fetch
    });
    this.httpClient = new HttpClient({
      baseUrl: options.apiBaseUrl,
      fetch: this.runtime.fetch,
      onUnauthorized: async () => {
        await this.refreshSession(true);
        return this.session?.accessToken ?? null;
      }
    });
  }

  async connect(): Promise<void> {
    if (this.connectFlight) {
      return this.connectFlight;
    }

    this.assertOpen();
    this.connectFlight = this.connectInternal().finally(() => {
      this.connectFlight = null;
    });
    return this.connectFlight;
  }

  async refresh(): Promise<void> {
    if (this.refreshFlight) {
      return this.refreshFlight;
    }

    this.assertOpen();
    this.refreshFlight = this.refreshInternal().finally(() => {
      this.refreshFlight = null;
    });
    return this.refreshFlight;
  }

  async close(): Promise<void> {
    if (this.closeFlight) {
      return this.closeFlight;
    }

    this.closeFlight = this.closeInternal().finally(() => {
      this.closeFlight = null;
    });
    return this.closeFlight;
  }

  private async connectInternal(): Promise<void> {
    this.room.setState('authenticating');
    await this.ensureSession();

    this.room.setState('bootstrapping');
    const bootstrap = await this.fetchBootstrap();
    this.applyBootstrap(bootstrap, true);

    this.room.setState('connecting');
    try {
      await this.startRealtime();
    } catch (error) {
      this.degradeRealtime(error);
      return;
    }

    this.room.setState('synchronizing');
    await this.catchUpMessages();
    this.room.drainBufferedEvents();
    this.room.setState('ready');
  }

  private async refreshInternal(): Promise<void> {
    this.room.setState('reconnecting');
    await this.refreshSession(false);
    const bootstrap = await this.fetchBootstrap();
    this.applyBootstrap(bootstrap, false);
    try {
      await this.restartRealtime();
    } catch (error) {
      this.degradeRealtime(error);
      return;
    }
    await this.catchUpMessages();
    this.room.drainBufferedEvents();
    this.room.setState('ready');
  }

  private async closeInternal(): Promise<void> {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.room.setState('closed');

    await this.disposeRealtime();

    if (this.session) {
      await this.httpClient
        .request<null>({
          method: 'DELETE',
          path: '/sdk/v1/sessions/current',
          accessToken: this.session.accessToken,
          retryOnUnauthorized: false
        })
        .catch(() => undefined);
    }

    this.session = null;
    this.currentBootstrap = null;
    this.user.clear();
  }

  private async ensureSession(): Promise<SessionState> {
    if (this.session && !isExpired(this.session.expiresAt, this.runtime.now())) {
      return this.session;
    }

    const next = await this.createSession();
    this.session = next;
    return next;
  }

  private async refreshSession(force: boolean): Promise<SessionState | null> {
    const current = this.session;
    if (!current) {
      return this.ensureSession();
    }

    if (!force && !isExpired(current.expiresAt, this.runtime.now())) {
      return current;
    }

    if (this.options.auth.type === 'ticket') {
      throw new LiveRoomSdkError({
        code: 'SESSION_EXPIRED',
        message: 'Ticket sessions cannot be refreshed after expiry.'
      });
    }

    const next = await this.createSession();
    this.session = next;
    return next;
  }

  private async createSession(): Promise<SessionState> {
    let sessionResponse: SessionResponse;

    if (this.options.auth.type === 'ticket') {
      const response = await this.authClient.request<SessionResponse>({
        method: 'POST',
        path: '/sdk/v1/sessions/exchange',
        body: { ticket: this.options.auth.ticket },
        retryOnUnauthorized: false
      });
      sessionResponse = response.data;
    } else {
      if (!this.options.roomId) {
        throw new LiveRoomSdkError({
          code: 'INVALID_RESPONSE',
          message: 'roomId is required for platform-operator auth.'
        });
      }

      const platformToken = await this.options.auth.getAccessToken();
      const response = await this.authClient.request<SessionResponse>({
        method: 'POST',
        path: `/sdk/v1/rooms/${encodeURIComponent(this.options.roomId)}/operator-session`,
        accessToken: platformToken,
        retryOnUnauthorized: false
      });
      sessionResponse = response.data;
    }

    return {
      sessionId: sessionResponse.session_id,
      accessToken: sessionResponse.access_token,
      expiresAt: parseExpiry(sessionResponse.expires_at)
    };
  }

  private async fetchBootstrap(): Promise<BootstrapResponse> {
    const session = await this.ensureSession();
    const response = await this.httpClient.request<BootstrapResponse>({
      method: 'GET',
      path: '/sdk/v1/rooms/current/bootstrap',
      accessToken: session.accessToken
    });
    return response.data;
  }

  private applyBootstrap(bootstrap: BootstrapResponse, resetMessages: boolean): void {
    this.currentBootstrap = bootstrap;
    this.user.hydrate({
      id: bootstrap.user.id,
      externalId: bootstrap.user.external_id,
      nickname: bootstrap.user.nickname,
      avatarUrl: bootstrap.user.avatar_url,
      role: bootstrap.user.role,
      capabilities: bootstrap.user.capabilities ?? []
    });

    const { snapshot, sequence } = normalizeRoomSnapshot(bootstrap);
    if (this.options.roomId && snapshot.id && this.options.auth.type === 'ticket' && this.options.roomId !== snapshot.id) {
      throw new LiveRoomSdkError({
        code: 'ROOM_NOT_ACCESSIBLE',
        message: `Expected room ${this.options.roomId} but bootstrap returned ${snapshot.id}.`
      });
    }

    if (resetMessages) {
      this.room.replaceSnapshot(snapshot, sequence);
    } else {
      this.room.updateSnapshot(snapshot);
    }
    this.room.beginSync(sequence);
  }

  private async fetchRealtimeCredential(): Promise<RealtimeCredentialResponse> {
    const session = await this.ensureSession();
    const response = await this.httpClient.request<RealtimeCredentialResponse>({
      method: 'POST',
      path: '/sdk/v1/rooms/current/realtime-credential',
      accessToken: session.accessToken
    });
    return response.data;
  }

  private async startRealtime(): Promise<void> {
    const credential = await this.fetchRealtimeCredential();
    await this.attachRealtimeSafely(credential);
  }

  private async restartRealtime(): Promise<void> {
    await this.disposeRealtime();
    const credential = await this.fetchRealtimeCredential();
    await this.attachRealtimeSafely(credential);
  }

  private async attachRealtimeSafely(credential: RealtimeCredentialResponse): Promise<void> {
    try {
      await this.attachRealtime(credential);
    } catch (error) {
      await this.disposeRealtime();
      throw error;
    }
  }

  private degradeRealtime(error: unknown): void {
    const normalized = error instanceof Error
      ? error
      : new LiveRoomSdkError({
          code: 'NETWORK_ERROR',
          message: 'Realtime connection failed.'
        });

    this.room.emitError(normalized);
    this.room.setState('degraded');
  }

  private async attachRealtime(credential: RealtimeCredentialResponse): Promise<void> {
    this.goeasyConnection = await connectGoEasy(
      this.runtime,
      credential.goeasy,
      (event) => {
        this.room.applyRealtimeEvent(event);
      },
      this.logger
    );

    if (this.user.role === 'viewer' && credential.websocket?.ticket) {
      const roomSnapshot = this.room.info;
      if (!roomSnapshot) {
        throw new LiveRoomSdkError({
          code: 'INVALID_RESPONSE',
          message: 'Room bootstrap must complete before opening websocket.'
        });
      }

      this.websocketTransport = new ViewerWebSocketTransport(
        this.runtime,
        async () => {
          const next = await this.fetchRealtimeCredential();
          if (!next.websocket) {
            throw new LiveRoomSdkError({
              code: 'WEBSOCKET_AUTH_FAILED',
              message: 'Viewer websocket credentials are not available.'
            });
          }
          return {
            url: next.websocket.url,
            ticket: next.websocket.ticket
          };
        },
        {
          onReady: (online) => this.room.setOnline(online),
          onOnlineChanged: (online) => this.room.setOnline(online),
          onRoomStatusChanged: (status) => this.room.setRoomStatus(status),
          onError: (error) => this.room.emitError(error),
          onReconnecting: () => this.room.setState('reconnecting')
        },
        roomSnapshot,
        this.logger
      );
      await this.websocketTransport.open();
    }
  }

  private async disposeRealtime(): Promise<void> {
    const websocket = this.websocketTransport;
    this.websocketTransport = null;
    await websocket?.close();

    const goeasy = this.goeasyConnection;
    this.goeasyConnection = null;
    await goeasy?.close();
  }

  private async catchUpMessages(): Promise<void> {
    const sequence = this.room.getLastSequence();
    if (sequence === null) {
      return;
    }

    const session = await this.ensureSession();
    let response: {
      data: {
        messages?: RoomMessage[];
        events?: Array<Record<string, unknown>>;
      };
      requestId: string | undefined;
    };
    try {
      response = await this.httpClient.request<{
        messages?: RoomMessage[];
        events?: Array<Record<string, unknown>>;
      }>({
        method: 'GET',
        path: '/sdk/v1/rooms/current/messages',
        query: {
          after_sequence: sequence
        },
        accessToken: session.accessToken
      });
    } catch (error) {
      if (isMessageHistoryUnavailable(error)) {
        return;
      }
      throw error;
    }

    for (const event of response.data.events ?? []) {
      this.room.applyRealtimeEvent(event as never);
    }
  }

  private async refreshInfo(): Promise<RoomSnapshot> {
    const bootstrap = await this.fetchBootstrap();
    const { snapshot } = normalizeRoomSnapshot(bootstrap);
    this.currentBootstrap = bootstrap;
    this.room.updateSnapshot(snapshot);
    return snapshot;
  }

  private async refreshMedia(): Promise<readonly MediaSource[]> {
    const session = await this.ensureSession();
    const response = await this.httpClient.request<{
      playback?: {
        mode?: string;
        sources?: Array<{
          protocol: string;
          url: string;
          expires_at?: string;
        }>;
      };
      sources?: Array<{
        protocol: string;
        url: string;
        expires_at?: string;
      }>;
    }>({
      method: 'POST',
      path: '/sdk/v1/rooms/current/refresh-media',
      accessToken: session.accessToken
    });

    const current = this.room.info;
    const sources = normalizeMediaSources(response.data.playback?.sources ?? response.data.sources);
    if (current) {
      current.playback = {
        mode: response.data.playback?.mode ?? current.playback?.mode,
        sources
      };
    }
    return sources;
  }

  private async loadPreviousMessages(cursor?: string): Promise<MessagePage> {
    const session = await this.ensureSession();
    const response = await this.httpClient.request<{
      messages?: RoomMessage[];
      next_cursor?: string;
      has_more?: boolean;
    }>({
      method: 'GET',
      path: '/sdk/v1/rooms/current/messages',
      query: {
        before_cursor: cursor
      },
      accessToken: session.accessToken
    });

    return {
      messages: response.data.messages ?? [],
      nextCursor: response.data.next_cursor,
      hasMore: Boolean(response.data.has_more)
    };
  }

  private async sendComment(text: string): Promise<PendingMessage> {
    this.requireCapability('message:send');
    const session = await this.ensureSession();
    const clientRequestId = this.runtime.createId('cr');
    const pending: PendingMessage = {
      messageId: this.runtime.createId('pending'),
      eventId: undefined,
      clientRequestId,
      sequence: undefined,
      author: {
        id: this.user.id,
        nickname: this.user.nickname,
        avatarUrl: this.user.avatarUrl
      },
      content: {
        type: 'text',
        text
      },
      state: 'pending',
      createdAt: new Date(this.runtime.now()).toISOString()
    };

    this.room.trackPending(pending);

    try {
      await this.httpClient.request<{
        message_id?: string;
        created_at?: string;
      }>({
        method: 'POST',
        path: '/sdk/v1/rooms/current/commands/comments',
        accessToken: session.accessToken,
        body: {
          client_request_id: clientRequestId,
          content: {
            type: 'text',
            text
          }
        }
      });
      pending.state = 'accepted';
      return pending;
    } catch (error) {
      pending.state = 'rejected';
      throw error;
    }
  }

  private async sendLike(count = 1): Promise<void> {
    this.requireCapability('message:send');
    const session = await this.ensureSession();
    await this.httpClient.request<null>({
      method: 'POST',
      path: '/sdk/v1/rooms/current/commands/likes',
      accessToken: session.accessToken,
      body: { count }
    });
  }

  private async deleteComment(messageId: string, reason?: string): Promise<void> {
    this.requireCapability('message:delete');
    const session = await this.ensureSession();
    await this.httpClient.request<null>({
      method: 'POST',
      path: '/sdk/v1/rooms/current/commands/delete-comment',
      accessToken: session.accessToken,
      body: {
        message_id: messageId,
        reason
      }
    });
  }

  private async muteUser(userId: string, durationSeconds?: number): Promise<void> {
    this.requireCapability('user:mute');
    const session = await this.ensureSession();
    await this.httpClient.request<null>({
      method: 'POST',
      path: '/sdk/v1/rooms/current/commands/mute-user',
      accessToken: session.accessToken,
      body: {
        user_id: userId,
        duration_seconds: durationSeconds
      }
    });
  }

  private async unmuteUser(userId: string): Promise<void> {
    this.requireCapability('user:mute');
    const session = await this.ensureSession();
    await this.httpClient.request<null>({
      method: 'POST',
      path: '/sdk/v1/rooms/current/commands/unmute-user',
      accessToken: session.accessToken,
      body: {
        user_id: userId
      }
    });
  }

  private async setRoomMute(enabled: boolean): Promise<void> {
    this.requireCapability('room:mute');
    const session = await this.ensureSession();
    await this.httpClient.request<null>({
      method: 'POST',
      path: '/sdk/v1/rooms/current/commands/room-mute',
      accessToken: session.accessToken,
      body: { enabled }
    });
  }

  private requireCapability(capability: RoomCapability): void {
    if (this.user.role === 'operator' && this.user.capabilities.includes(capability)) {
      return;
    }
    if (capability === 'message:send' && this.user.capabilities.includes(capability)) {
      return;
    }

    throw new LiveRoomSdkError({
      code: 'CAPABILITY_DENIED',
      message: `Missing required capability: ${capability}`
    });
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new LiveRoomSdkError({
        code: 'SDK_CLOSED',
        message: 'The SDK has already been closed.'
      });
    }
  }
}

export function createLiveRoomSdk(options: LiveRoomSdkOptions): LiveRoomSdk {
  return new LiveRoomSdkImpl(options);
}
