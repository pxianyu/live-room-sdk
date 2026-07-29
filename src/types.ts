export type RoomCapability =
  | 'room:view'
  | 'message:read'
  | 'message:send'
  | 'message:delete'
  | 'user:mute'
  | 'room:mute'
  | 'metrics:read';

export type RoomConnectionState =
  | 'idle'
  | 'authenticating'
  | 'bootstrapping'
  | 'connecting'
  | 'synchronizing'
  | 'ready'
  | 'reconnecting'
  | 'degraded'
  | 'ended'
  | 'closed'
  | 'error';

export interface LiveRoomLogger {
  debug?(message: string, meta?: Record<string, unknown>): void;
  info?(message: string, meta?: Record<string, unknown>): void;
  warn?(message: string, meta?: Record<string, unknown>): void;
  error?(message: string, meta?: Record<string, unknown>): void;
}

export interface LiveRoomSdkOptions {
  apiBaseUrl: string;
  auth:
    | {
        type: 'ticket';
        ticket: string;
      }
    | {
        type: 'platform-operator';
        getAccessToken: () => string | Promise<string>;
      };
  roomId?: string;
  fetch?: typeof fetch;
  logger?: LiveRoomLogger;
}

export interface LiveRoomUser {
  readonly id: string;
  readonly externalId: string | undefined;
  readonly nickname: string;
  readonly avatarUrl: string | undefined;
  readonly role: 'viewer' | 'operator';
  readonly capabilities: readonly RoomCapability[];
}

export interface MediaSource {
  protocol: string;
  url: string;
  expiresAt: string | undefined;
}

export interface RoomPlayback {
  mode: string | undefined;
  sources: readonly MediaSource[];
}

export interface RoomSnapshot {
  id: string;
  title: string | undefined;
  status: string | undefined;
  muted: boolean | undefined;
  notice: string | undefined;
  features: Record<string, boolean> | undefined;
  playback: RoomPlayback | undefined;
}

export interface RoomMessageAuthor {
  id: string;
  nickname: string;
  avatarUrl: string | undefined;
}

export interface RoomMessageContent {
  type: 'text';
  text: string;
}

export interface RoomMessage {
  messageId: string;
  eventId: string | undefined;
  clientRequestId: string | undefined;
  sequence: number | undefined;
  author: RoomMessageAuthor;
  content: RoomMessageContent;
  state: 'pending' | 'accepted' | 'committed' | 'rejected' | 'deleted';
  createdAt: string;
}

export interface PendingMessage extends RoomMessage {}

export interface MessagePage {
  messages: readonly RoomMessage[];
  nextCursor: string | undefined;
  hasMore: boolean;
}

export type RoomEventName =
  | 'state.changed'
  | 'room.status.changed'
  | 'online.changed'
  | 'message.created'
  | 'message.deleted'
  | 'user.muted'
  | 'room.muted'
  | 'notice.updated'
  | 'error';

export interface RoomStateChangedEvent {
  previous: RoomConnectionState;
  current: RoomConnectionState;
}

export interface RoomStatusChangedEvent {
  room: RoomSnapshot;
}

export interface OnlineChangedEvent {
  online: number | null;
}

export interface MessageCreatedEvent {
  message: RoomMessage;
}

export interface MessageDeletedEvent {
  messageId: string;
  reason: string | undefined;
}

export interface UserMutedEvent {
  userId: string;
  durationSeconds: number | undefined;
  expiresAt: string | undefined;
  reason: string | undefined;
}

export interface RoomMutedEvent {
  enabled: boolean;
}

export interface NoticeUpdatedEvent {
  notice: string;
}

export interface RoomErrorEvent {
  error: Error;
}

export interface LiveRoomEventMap {
  'state.changed': RoomStateChangedEvent;
  'room.status.changed': RoomStatusChangedEvent;
  'online.changed': OnlineChangedEvent;
  'message.created': MessageCreatedEvent;
  'message.deleted': MessageDeletedEvent;
  'user.muted': UserMutedEvent;
  'room.muted': RoomMutedEvent;
  'notice.updated': NoticeUpdatedEvent;
  error: RoomErrorEvent;
}

export type RoomEventHandler<T extends RoomEventName> = (event: LiveRoomEventMap[T]) => void;

export interface LiveRoom {
  readonly id: string;
  readonly state: RoomConnectionState;
  readonly info: RoomSnapshot | null;
  readonly messages: readonly RoomMessage[];
  readonly online: number | null;

  open(): Promise<void>;
  refreshInfo(): Promise<RoomSnapshot>;
  refreshMedia(): Promise<readonly MediaSource[]>;
  loadPreviousMessages(cursor?: string): Promise<MessagePage>;

  sendComment(text: string): Promise<PendingMessage>;
  sendLike(count?: number): Promise<void>;

  deleteComment(messageId: string, reason?: string): Promise<void>;
  muteUser(userId: string, durationSeconds?: number): Promise<void>;
  unmuteUser(userId: string): Promise<void>;
  setRoomMute(enabled: boolean): Promise<void>;

  on<T extends RoomEventName>(event: T, handler: RoomEventHandler<T>): () => void;

  close(): Promise<void>;
}

export interface LiveRoomSdk {
  readonly user: LiveRoomUser;
  readonly room: LiveRoom;

  connect(): Promise<void>;
  refresh(): Promise<void>;
  close(): Promise<void>;
}

export interface ApiEnvelope<T> {
  data: T;
  request_id: string | undefined;
  error?: {
    code?: string;
    message?: string;
    retryable?: boolean;
  };
}

export interface SessionResponse {
  session_id: string;
  role: 'viewer' | 'operator';
  access_token: string;
  expires_at: string;
}

export interface BootstrapResponse {
  server_time?: string;
  user: {
    id: string;
    external_id?: string;
    nickname: string;
    avatar_url?: string;
    role: 'viewer' | 'operator';
    capabilities?: RoomCapability[];
  };
  room: {
    id: string;
    title?: string;
    status?: string;
    muted?: boolean;
    notice?: string;
    sequence?: number;
    current_sequence?: number;
    features?: Record<string, boolean>;
    playback?: {
      mode?: string;
      sources?: Array<{
        protocol: string;
        url: string;
        expires_at?: string;
      }>;
    };
  };
  realtime?: {
    credential_url?: string;
    ws_url?: string;
  };
}

export interface RealtimeCredentialResponse {
  goeasy: {
    host: string;
    client_key: string;
    connect_id: string;
    otp: string;
    channel: string;
    access_token: string;
    expires_at?: string;
  };
  websocket?: {
    url: string;
    ticket: string;
    expires_at?: string;
  };
}

export interface RealtimeEnvelope {
  event_id?: string;
  event_type?: string;
  room_id?: string;
  sequence?: number;
  occurred_at?: string;
  data?: Record<string, unknown>;
}
