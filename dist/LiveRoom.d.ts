import type { LiveRoom, MediaSource, MessagePage, PendingMessage, RealtimeEnvelope, RoomEventHandler, RoomEventName, RoomMessage, RoomSnapshot, RoomConnectionState } from './types.js';
export interface RoomDelegate {
    connect(): Promise<void>;
    refresh(): Promise<void>;
    close(): Promise<void>;
    refreshInfo(): Promise<RoomSnapshot>;
    refreshMedia(): Promise<readonly MediaSource[]>;
    loadPreviousMessages(cursor?: string): Promise<MessagePage>;
    sendComment(text: string): Promise<PendingMessage>;
    sendLike(count?: number): Promise<void>;
    deleteComment(messageId: string, reason?: string): Promise<void>;
    muteUser(userId: string): Promise<void>;
    unmuteUser(userId: string): Promise<void>;
    setRoomMute(enabled: boolean): Promise<void>;
}
export declare class LiveRoomState implements LiveRoom {
    private readonly delegate;
    private readonly emitter;
    private readonly reducer;
    private connectionState;
    private snapshot;
    private onlineCount;
    constructor(delegate: RoomDelegate);
    get id(): string;
    get state(): RoomConnectionState;
    get info(): RoomSnapshot | null;
    get messages(): readonly RoomMessage[];
    get online(): number | null;
    open(): Promise<void>;
    refreshInfo(): Promise<RoomSnapshot>;
    refreshMedia(): Promise<readonly MediaSource[]>;
    loadPreviousMessages(cursor?: string): Promise<MessagePage>;
    sendComment(text: string): Promise<PendingMessage>;
    sendLike(count?: number): Promise<void>;
    deleteComment(messageId: string, reason?: string): Promise<void>;
    muteUser(userId: string): Promise<void>;
    unmuteUser(userId: string): Promise<void>;
    setRoomMute(enabled: boolean): Promise<void>;
    on<T extends RoomEventName>(event: T, handler: RoomEventHandler<T>): () => void;
    close(): Promise<void>;
    replaceSnapshot(snapshot: RoomSnapshot, sequence?: number | null): void;
    updateSnapshot(snapshot: RoomSnapshot): void;
    setState(next: RoomConnectionState): void;
    setOnline(online: number | null): void;
    setRoomStatus(status: string): void;
    beginSync(sequence?: number | null): void;
    applyRealtimeEvent(event: RealtimeEnvelope): void;
    drainBufferedEvents(): void;
    trackPending(message: PendingMessage): void;
    hydrateHistory(messages: ReadonlyArray<Record<string, unknown>>): RoomMessage[];
    getLastSequence(): number | null;
    emitError(error: Error): void;
    private emitReducerEvents;
    private requireSnapshot;
}
//# sourceMappingURL=LiveRoom.d.ts.map