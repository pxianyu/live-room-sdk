import type { LiveRoomLogger, RoomSnapshot } from '../types.js';
import type { LiveRoomRuntime } from './runtime.js';
export interface ViewerWebSocketCredential {
    url: string;
    ticket: string;
}
export interface ViewerWebSocketCallbacks {
    onReady(online: number | null): void;
    onOnlineChanged(online: number | null): void;
    onRoomStatusChanged(status: string): void;
    onError(error: Error): void;
    onReconnecting(): void;
}
export declare class ViewerWebSocketTransport {
    private readonly runtime;
    private readonly getCredential;
    private readonly callbacks;
    private readonly room;
    private readonly logger?;
    private socket;
    private connectPromise;
    private closed;
    private socketGeneration;
    private reconnectAttempts;
    private heartbeatTimer;
    private reconnectTimer;
    private detachSocketListeners;
    private cancelOpen;
    constructor(runtime: LiveRoomRuntime, getCredential: () => Promise<ViewerWebSocketCredential>, callbacks: ViewerWebSocketCallbacks, room: RoomSnapshot, logger?: LiveRoomLogger | undefined);
    open(): Promise<void>;
    close(): Promise<void>;
    private connectNextSocket;
    private startHeartbeat;
    private stopHeartbeat;
    private scheduleReconnect;
    private clearReconnectTimer;
}
//# sourceMappingURL=websocket.d.ts.map