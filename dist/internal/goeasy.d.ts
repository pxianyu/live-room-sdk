import type { GoEasyCallbacks, GoEasyChatConfig, GoEasyConnection, GoEasyMessage, LiveUser } from '../types.js';
export declare function parseGoEasyMessage(value: unknown): GoEasyMessage;
export declare function connectGoEasy(config: GoEasyChatConfig, user: LiveUser, liveId: string | number, callbacks?: GoEasyCallbacks): Promise<GoEasyConnection>;
//# sourceMappingURL=goeasy.d.ts.map