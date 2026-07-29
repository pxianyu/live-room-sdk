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
export declare class HttpClient {
    private readonly options;
    constructor(options: HttpClientOptions);
    request<T>(request: HttpClientRequest): Promise<{
        data: T;
        requestId: string | undefined;
    }>;
    private execute;
}
//# sourceMappingURL=HttpClient.d.ts.map