export type LiveRoomErrorCode =
  | 'INVALID_TICKET'
  | 'SESSION_EXPIRED'
  | 'ORIGIN_DENIED'
  | 'ROOM_NOT_ACCESSIBLE'
  | 'CAPABILITY_DENIED'
  | 'USER_MUTED'
  | 'RATE_LIMITED'
  | 'GOEASY_CONNECT_FAILED'
  | 'GOEASY_SUBSCRIBE_FAILED'
  | 'WEBSOCKET_AUTH_FAILED'
  | 'NETWORK_ERROR'
  | 'SDK_CLOSED'
  | 'INVALID_RESPONSE'
  | 'AUTHENTICATION_REQUIRED'
  | 'VALIDATION_FAILED'
  | 'CONFLICT'
  | 'RESOURCE_NOT_FOUND'
  | 'INVALID_REQUEST'
  | 'BODY_TOO_LARGE'
  | 'INTERNAL_ERROR';

export interface LiveRoomSdkErrorInit {
  code: LiveRoomErrorCode;
  message: string;
  requestId?: string | undefined;
  retryable?: boolean;
  status?: number | undefined;
  businessCode?: number | undefined;
  cause?: unknown;
}

export class LiveRoomSdkError extends Error {
  readonly code: LiveRoomErrorCode;
  readonly requestId: string | undefined;
  readonly retryable: boolean;
  readonly status: number | undefined;
  readonly businessCode: number | undefined;

  constructor(init: LiveRoomSdkErrorInit) {
    super(init.message, init.cause ? { cause: init.cause } : undefined);
    this.name = 'LiveRoomSdkError';
    this.code = init.code;
    this.requestId = init.requestId;
    this.retryable = init.retryable ?? false;
    this.status = init.status;
    this.businessCode = init.businessCode;
  }
}

export function isLiveRoomSdkError(error: unknown): error is LiveRoomSdkError {
  return error instanceof LiveRoomSdkError;
}
