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
    trackPending(message: RoomMessage): void;
    beginBuffering(startSequence?: number | null): void;
    drainBufferedEvents(room: RoomSnapshot | null): ReducerEmission[];
    applyRealtimeEvent(event: RealtimeEnvelope, room: RoomSnapshot | null): ReducerEmission[];
    getLastSequence(): number | null;
    private applyMessageCreated;
    private applyMessageDeleted;
}
//# sourceMappingURL=event-reducer.d.ts.map