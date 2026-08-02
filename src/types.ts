export type LiveApiMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export interface LiveApiResponse<T = unknown> {
  status: number;
  data: T;
  msg?: string;
  message?: string;
  [key: string]: unknown;
}

export interface LiveApiRequest {
  query?: Record<string, string | number | boolean | undefined>;
  data?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export interface LiveApiClient {
  request<T = unknown>(method: LiveApiMethod, path: string, request?: LiveApiRequest): Promise<LiveApiResponse<T>>;
  get<T = unknown>(path: string, query?: LiveApiRequest['query']): Promise<LiveApiResponse<T>>;
  post<T = unknown>(path: string, data?: unknown): Promise<LiveApiResponse<T>>;
  put<T = unknown>(path: string, data?: unknown): Promise<LiveApiResponse<T>>;
  del<T = unknown>(path: string, data?: unknown): Promise<LiveApiResponse<T>>;
  getAction<T = unknown>(path: string, query?: LiveApiRequest['query']): Promise<LiveApiResponse<T>>;
  postAction<T = unknown>(path: string, data?: unknown): Promise<LiveApiResponse<T>>;
}

export interface GoEasyChatConfig {
  type?: number;
  host: string;
  authorization: {
    mode: 'otp';
    client_key: string;
    otp: string;
  };
}

export interface LiveUser {
  id: string | number;
  nickname: string;
  avatar?: string;
  spid?: string | number;
  city?: string;
}

export type GoEasyMessage = Record<string, unknown>;

export interface GoEasyCallbacks {
  onMessage?(message: GoEasyMessage): void;
  onPresence?(event: unknown): void;
  onError?(error: unknown): void;
}

export interface GoEasyConnection {
  publish(message: GoEasyMessage): Promise<void>;
  getOnlineUsers(): Promise<unknown>;
  close(): Promise<void>;
}

export interface ViewingContext {
  liveLogId?: number;
  watchScene?: 'live' | 'playback';
  materialId?: number;
  fileId?: string;
  randomUser?: unknown;
}

export interface ViewingCallbacks {
  onOpen?(): void;
  onClose?(event: CloseEvent): void;
  onMessage?(message: unknown): void;
  onError?(error: unknown): void;
  onReconnecting?(attempt: number): void;
}

export interface ViewingConnection {
  send(message: Record<string, unknown>): void;
  close(): void;
}

export interface LiveRoomSdkOptions {
  apiBaseUrl: string;
  accessToken: string;
  uniacid: string | number;
  liveId: string | number;
  websocketUrl?: string;
  fetch?: typeof fetch;
  webSocketFactory?: (url: string) => WebSocket;
}

export interface LiveRoomSdk {
  api: LiveApiClient;
  live: {
    getInfo(query?: LiveApiRequest['query']): Promise<LiveApiResponse<Record<string, unknown>>>;
    getPublicInfo(query?: LiveApiRequest['query']): Promise<LiveApiResponse<Record<string, unknown>>>;
    getIntoInfo<T = unknown>(): Promise<LiveApiResponse<T>>;
    updateLeave<T = unknown>(id: string | number): Promise<LiveApiResponse<T>>;
    getUserInfo<T = unknown>(): Promise<LiveApiResponse<T>>;
    getComments<T = unknown>(query?: LiveApiRequest['query']): Promise<LiveApiResponse<T>>;
    like<T = unknown>(query?: LiveApiRequest['query']): Promise<LiveApiResponse<T>>;
    filterComment<T = unknown>(data: unknown): Promise<LiveApiResponse<T>>;
    createComment<T = unknown>(data: unknown): Promise<LiveApiResponse<T>>;
  };
  realtime: {
    connectGoEasy(config: GoEasyChatConfig, user: LiveUser, callbacks?: GoEasyCallbacks): Promise<GoEasyConnection>;
    connectViewing(user: LiveUser, callbacks?: ViewingCallbacks, context?: ViewingContext): ViewingConnection;
  };
  close(): Promise<void>;
}
