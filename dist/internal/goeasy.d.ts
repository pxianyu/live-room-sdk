import type { LiveRoomLogger, RealtimeCredentialResponse, RealtimeEnvelope } from '../types.js';
import type { LiveRoomRuntime } from './runtime.js';
export interface GoEasyConnection {
    close(): Promise<void>;
}
export declare function connectGoEasy(runtime: LiveRoomRuntime, credential: RealtimeCredentialResponse['goeasy'], onEvent: (event: RealtimeEnvelope) => void, logger?: LiveRoomLogger): Promise<GoEasyConnection>;
//# sourceMappingURL=goeasy.d.ts.map