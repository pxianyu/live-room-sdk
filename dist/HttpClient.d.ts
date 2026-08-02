import type { LiveApiClient } from './types.js';
interface LiveApiOptions {
    baseUrl: string;
    accessToken: string;
    liveId: string | number;
    fetch?: typeof fetch;
}
export declare function createLiveApi(options: LiveApiOptions): LiveApiClient;
export {};
//# sourceMappingURL=HttpClient.d.ts.map