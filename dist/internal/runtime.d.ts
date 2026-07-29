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
export declare function createDefaultRuntime(fetchOverride: typeof fetch | undefined, logger?: LiveRoomLogger): LiveRoomRuntime;
//# sourceMappingURL=runtime.d.ts.map