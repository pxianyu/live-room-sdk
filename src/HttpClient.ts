import { LiveRoomSdkError, isLiveRoomSdkError } from './errors.js';
import type { ApiEnvelope } from './types.js';

export interface HttpClientRequest {
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  accessToken?: string;
  signal?: AbortSignal;
  retryOnUnauthorized?: boolean;
}

export interface HttpClientOptions {
  baseUrl: string;
  fetch: typeof fetch;
  onUnauthorized?: () => Promise<string | null>;
}

function joinUrl(baseUrl: string, path: string, query?: Record<string, string | number | undefined>): string {
  const url = new URL(path.replace(/^\//, ''), baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url.toString();
}

function inferErrorCode(status: number, fallback: string | undefined): LiveRoomSdkError['code'] {
  switch (fallback) {
    case 'INVALID_TICKET':
    case 'SESSION_EXPIRED':
    case 'ORIGIN_DENIED':
    case 'ROOM_NOT_ACCESSIBLE':
    case 'CAPABILITY_DENIED':
    case 'USER_MUTED':
    case 'RATE_LIMITED':
    case 'FEATURE_NOT_AVAILABLE':
    case 'GOEASY_CONNECT_FAILED':
    case 'GOEASY_SUBSCRIBE_FAILED':
    case 'WEBSOCKET_AUTH_FAILED':
    case 'NETWORK_ERROR':
    case 'SDK_CLOSED':
    case 'INVALID_RESPONSE':
    case 'AUTHENTICATION_REQUIRED':
      return fallback;
    default:
      return status === 401 ? 'SESSION_EXPIRED' : 'NETWORK_ERROR';
  }
}

export class HttpClient {
  constructor(private readonly options: HttpClientOptions) {}

  async request<T>(request: HttpClientRequest): Promise<{ data: T; requestId: string | undefined }> {
    return this.execute<T>(request, false);
  }

  private async execute<T>(request: HttpClientRequest, retried: boolean): Promise<{ data: T; requestId: string | undefined }> {
    try {
      const init: RequestInit = {
        method: request.method,
        headers: {
          Accept: 'application/json',
          ...(request.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(request.accessToken ? { Authorization: `Bearer ${request.accessToken}` } : {})
        }
      };
      if (request.body !== undefined) {
        init.body = JSON.stringify(request.body);
      }
      if (request.signal) {
        init.signal = request.signal;
      }

      const response = await this.options.fetch(joinUrl(this.options.baseUrl, request.path, request.query), init);

      const envelope = (await response.json().catch(async () => {
        const text = await response.text();
        throw new LiveRoomSdkError({
          code: 'INVALID_RESPONSE',
          message: `Expected JSON response but received: ${text.slice(0, 120)}`,
          status: response.status
        });
      })) as ApiEnvelope<T>;

      if (response.status === 401 && request.retryOnUnauthorized !== false && !retried && this.options.onUnauthorized) {
        const nextToken = await this.options.onUnauthorized();
        if (nextToken) {
          return this.execute(
            {
              ...request,
              accessToken: nextToken
            },
            true
          );
        }
      }

      if (!response.ok || envelope.error) {
        throw new LiveRoomSdkError({
          code: inferErrorCode(response.status, envelope.error?.code),
          message: envelope.error?.message ?? response.statusText,
          requestId: envelope.request_id,
          retryable: envelope.error?.retryable ?? response.status >= 500,
          status: response.status
        });
      }

      return {
        data: envelope.data,
        requestId: envelope.request_id
      };
    } catch (error) {
      if (isLiveRoomSdkError(error)) {
        throw error;
      }

      throw new LiveRoomSdkError({
        code: 'NETWORK_ERROR',
        message: error instanceof Error ? error.message : 'Network request failed.',
        retryable: true,
        cause: error
      });
    }
  }
}
