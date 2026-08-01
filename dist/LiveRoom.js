import { TypedEventEmitter } from './internal/emitter.js';
import { RoomEventReducer } from './internal/event-reducer.js';
export class LiveRoomState {
    delegate;
    emitter = new TypedEventEmitter();
    reducer = new RoomEventReducer();
    connectionState = 'idle';
    snapshot = null;
    onlineCount = null;
    constructor(delegate) {
        this.delegate = delegate;
    }
    get id() {
        return this.snapshot?.id ?? '';
    }
    get state() {
        return this.connectionState;
    }
    get info() {
        return this.snapshot;
    }
    get messages() {
        return this.reducer.snapshotMessages();
    }
    get online() {
        return this.onlineCount;
    }
    open() {
        return this.delegate.connect();
    }
    refreshInfo() {
        return this.delegate.refreshInfo();
    }
    refreshMedia() {
        return this.delegate.refreshMedia();
    }
    loadPreviousMessages(cursor) {
        return this.delegate.loadPreviousMessages(cursor);
    }
    sendComment(text) {
        return this.delegate.sendComment(text);
    }
    sendLike(count) {
        return this.delegate.sendLike(count);
    }
    deleteComment(messageId, reason) {
        return this.delegate.deleteComment(messageId, reason);
    }
    muteUser(userId) {
        return this.delegate.muteUser(userId);
    }
    unmuteUser(userId) {
        return this.delegate.unmuteUser(userId);
    }
    setRoomMute(enabled) {
        return this.delegate.setRoomMute(enabled);
    }
    on(event, handler) {
        return this.emitter.on(event, handler);
    }
    close() {
        return this.delegate.close();
    }
    replaceSnapshot(snapshot, sequence) {
        this.snapshot = snapshot;
        this.reducer.reset(sequence);
    }
    updateSnapshot(snapshot) {
        this.snapshot = snapshot;
    }
    setState(next) {
        if (this.connectionState === next) {
            return;
        }
        const previous = this.connectionState;
        this.connectionState = next;
        this.emitter.emit('state.changed', {
            previous,
            current: next
        });
    }
    setOnline(online) {
        this.onlineCount = online;
        this.emitter.emit('online.changed', { online });
    }
    setRoomStatus(status) {
        if (!this.snapshot) {
            return;
        }
        this.snapshot.status = status;
        if (['STOPPED', 'ENDED'].includes(status.toUpperCase())) {
            this.setState('ended');
        }
        this.emitter.emit('room.status.changed', {
            room: this.snapshot
        });
    }
    beginSync(sequence) {
        this.reducer.beginBuffering(sequence);
    }
    applyRealtimeEvent(event) {
        this.emitReducerEvents(this.reducer.applyRealtimeEvent(event, this.requireSnapshot()));
    }
    drainBufferedEvents() {
        this.emitReducerEvents(this.reducer.drainBufferedEvents(this.requireSnapshot()));
    }
    trackPending(message) {
        this.reducer.trackPending(message);
    }
    hydrateHistory(messages) {
        return this.reducer.hydrateHistory(messages);
    }
    getLastSequence() {
        return this.reducer.getLastSequence();
    }
    emitError(error) {
        this.emitter.emit('error', { error });
    }
    emitReducerEvents(events) {
        for (const event of events) {
            if (event.name === 'room.status.changed') {
                const status = event.payload.room.status ?? '';
                if (['STOPPED', 'ENDED'].includes(status.toUpperCase())) {
                    this.setState('ended');
                }
            }
            this.emitter.emit(event.name, event.payload);
        }
    }
    requireSnapshot() {
        if (!this.snapshot) {
            return null;
        }
        return this.snapshot;
    }
}
//# sourceMappingURL=LiveRoom.js.map