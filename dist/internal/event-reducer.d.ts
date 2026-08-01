import type { LiveRoomEventMap, RealtimeEnvelope, RoomMessage, RoomSnapshot } from '../types.js';
export interface ReducerAppliedEvent<TKey extends keyof LiveRoomEventMap> {
    name: TKey;
    payload: LiveRoomEventMap[TKey];
}
export type ReducerEmission = ReducerAppliedEvent<keyof LiveRoomEventMap>;
export declare class RoomEventReducer {
    private readonly messages;
    private readonly messageIds;
    private readonly pendingByRequestId;
    private readonly appliedEventIds;
    private readonly bufferedEvents;
    private buffering;
    private lastSequence;
    reset(sequence?: number | null): void;
    snapshotMessages(): readonly RoomMessage[];
    /**
     * REST 历史和 GoEasy 事件使用同一条消息归并路径，避免回放后重复插入。
     *
     * @param messages 服务端返回的蛇形字段消息列表
     */
    hydrateHistory(messages: ReadonlyArray<Record<string, unknown>>): RoomMessage[];
    trackPending(message: RoomMessage): void;
    beginBuffering(startSequence?: number | null): void;
    drainBufferedEvents(room: RoomSnapshot | null): ReducerEmission[];
    applyRealtimeEvent(event: RealtimeEnvelope, room: RoomSnapshot | null): ReducerEmission[];
    getLastSequence(): number | null;
    private applyMessageCreated;
    private mergeMessage;
    private applyMessageDeleted;
}
//# sourceMappingURL=event-reducer.d.ts.map