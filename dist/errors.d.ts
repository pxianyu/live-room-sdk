export type LiveRoomErrorCode = 'INVALID_TICKET' | 'SESSION_EXPIRED' | 'ORIGIN_DENIED' | 'ROOM_NOT_ACCESSIBLE' | 'CAPABILITY_DENIED' | 'USER_MUTED' | 'RATE_LIMITED' | 'FEATURE_NOT_AVAILABLE' | 'GOEASY_CONNECT_FAILED' | 'GOEASY_SUBSCRIBE_FAILED' | 'WEBSOCKET_AUTH_FAILED' | 'NETWORK_ERROR' | 'SDK_CLOSED' | 'INVALID_RESPONSE' | 'AUTHENTICATION_REQUIRED';
export interface LiveRoomSdkErrorInit {
    code: LiveRoomErrorCode;
    message: string;
    requestId?: string | undefined;
    retryable?: boolean;
    status?: number | undefined;
    cause?: unknown;
}
export declare class LiveRoomSdkError extends Error {
    readonly code: LiveRoomErrorCode;
    readonly requestId: string | undefined;
    readonly retryable: boolean;
    readonly status: number | undefined;
    constructor(init: LiveRoomSdkErrorInit);
}
export declare function isLiveRoomSdkError(error: unknown): error is LiveRoomSdkError;
//# sourceMappingURL=errors.d.ts.map