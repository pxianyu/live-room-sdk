import { LiveRoomState } from './LiveRoom.js';
import { LiveRoomUserState } from './User.js';
import { type LiveRoomRuntime } from './internal/runtime.js';
import type { LiveRoomSdk, LiveRoomSdkOptions } from './types.js';
interface LiveRoomSdkRuntimeOptions {
    runtime?: LiveRoomRuntime;
}
export declare class LiveRoomSdkImpl implements LiveRoomSdk {
    private readonly options;
    readonly user: LiveRoomUserState;
    readonly room: LiveRoomState;
    private readonly logger;
    private readonly runtime;
    private readonly httpClient;
    private readonly authClient;
    private session;
    private currentBootstrap;
    private goeasyConnection;
    private websocketTransport;
    private closed;
    private connectFlight;
    private refreshFlight;
    private closeFlight;
    constructor(options: LiveRoomSdkOptions, runtimeOptions?: LiveRoomSdkRuntimeOptions);
    connect(): Promise<void>;
    refresh(): Promise<void>;
    close(): Promise<void>;
    private connectInternal;
    private refreshInternal;
    private closeInternal;
    private ensureSession;
    private refreshSession;
    private createSession;
    private fetchBootstrap;
    private applyBootstrap;
    private fetchRealtimeCredential;
    private startRealtime;
    private restartRealtime;
    private attachRealtimeSafely;
    private degradeRealtime;
    private attachRealtime;
    private disposeRealtime;
    private catchUpMessages;
    private refreshInfo;
    private refreshMedia;
    private loadPreviousMessages;
    private sendComment;
    private sendLike;
    private deleteComment;
    private muteUser;
    private unmuteUser;
    private setRoomMute;
    private requireCapability;
    private assertOpen;
}
export declare function createLiveRoomSdk(options: LiveRoomSdkOptions): LiveRoomSdk;
export {};
//# sourceMappingURL=LiveRoomSdk.d.ts.map