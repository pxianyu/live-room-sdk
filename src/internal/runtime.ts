import { LiveRoomSdkError } from '../errors.js';
import type { LiveRoomLogger } from '../types.js';

export interface GoEasyConnectError {
  code?: string | number;
  content?: string;
  message?: string;
}

export interface GoEasyMessage {
  content?: string | Record<string, unknown>;
}

export interface GoEasyInstance {
  connect(options: {
    id: string;
    otp: string;
    onSuccess: () => void;
    onFailed: (error: GoEasyConnectError) => void;
  }): void;
  disconnect?(options?: {
    onSuccess?: () => void;
    onFailed?: (error: GoEasyConnectError) => void;
  }): void;
  pubsub: {
    subscribe(options: {
      channel: string;
      accessToken: string;
      onMessage: (message: GoEasyMessage) => void;
      onSuccess: () => void;
      onFailed: (error: GoEasyConnectError) => void;
    }): void;
    unsubscribe?(options: {
      channel: string;
      onSuccess?: () => void;
      onFailed?: (error: GoEasyConnectError) => void;
    }): void;
  };
}

export interface GoEasyModule {
  getInstance(options: {
    host: string;
    appkey: string;
    modules: ['pubsub'];
  }): GoEasyInstance;
}

export interface WebSocketLike {
  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  readyState: number;
}

export interface LiveRoomRuntime {
  readonly fetch: typeof fetch;
  readonly createWebSocket: (url: string) => WebSocketLike;
  readonly loadGoEasy: () => Promise<GoEasyModule>;
  readonly now: () => number;
  readonly setTimeout: typeof globalThis.setTimeout;
  readonly clearTimeout: typeof globalThis.clearTimeout;
  readonly setInterval: typeof globalThis.setInterval;
  readonly clearInterval: typeof globalThis.clearInterval;
  readonly createId: (prefix: string) => string;
}

let fallbackId = 0;

function defaultCreateId(prefix: string): string {
  const cryptoObject = globalThis.crypto;
  if (cryptoObject?.randomUUID) {
    return `${prefix}_${cryptoObject.randomUUID()}`;
  }

  fallbackId += 1;
  return `${prefix}_${Date.now()}_${fallbackId}`;
}

export function createDefaultRuntime(fetchOverride: typeof fetch | undefined, logger?: LiveRoomLogger): LiveRoomRuntime {
  const runtimeFetch = fetchOverride ?? globalThis.fetch?.bind(globalThis);
  if (typeof runtimeFetch !== 'function') {
    throw new LiveRoomSdkError({
      code: 'INVALID_RESPONSE',
      message: 'A fetch implementation is required to create the SDK.'
    });
  }

  return {
    fetch: runtimeFetch,
    createWebSocket(url: string) {
      const WebSocketCtor = globalThis.WebSocket;
      if (typeof WebSocketCtor !== 'function') {
        throw new LiveRoomSdkError({
          code: 'INVALID_RESPONSE',
          message: 'WebSocket is not available in the current runtime.'
        });
      }

      return new WebSocketCtor(url);
    },
    async loadGoEasy() {
      const imported = await import('goeasy');
      const candidate = (imported.default ?? imported) as Partial<GoEasyModule>;

      if (typeof candidate.getInstance !== 'function') {
        logger?.error?.('goeasy module missing getInstance', {});
        throw new LiveRoomSdkError({
          code: 'INVALID_RESPONSE',
          message: 'Failed to load the goeasy client.'
        });
      }

      return candidate as GoEasyModule;
    },
    now: () => Date.now(),
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    setInterval: globalThis.setInterval.bind(globalThis),
    clearInterval: globalThis.clearInterval.bind(globalThis),
    createId: defaultCreateId
  };
}
