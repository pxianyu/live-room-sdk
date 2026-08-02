import type { LiveUser, ViewingCallbacks, ViewingConnection, ViewingContext } from '../types.js';
interface ViewingOptions {
    websocketUrl: string;
    accessToken: string;
    uniacid: string | number;
    liveId: string | number;
    user: LiveUser;
    callbacks: ViewingCallbacks;
    context: ViewingContext;
    webSocketFactory?: (url: string) => WebSocket;
}
export declare function connectViewingSocket(options: ViewingOptions): ViewingConnection;
export {};
//# sourceMappingURL=websocket.d.ts.map