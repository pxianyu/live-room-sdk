import { LiveRoomSdkError } from './errors.js';
import { TypedEventEmitter } from './internal/emitter.js';
import { RoomEventReducer, type ReducerEmission } from './internal/event-reducer.js';
import type {
  LiveRoom,
  LiveRoomEventMap,
  MediaSource,
  MessagePage,
  PendingMessage,
  RealtimeEnvelope,
  RoomEventHandler,
  RoomEventName,
  RoomMessage,
  RoomSnapshot,
  RoomConnectionState
} from './types.js';

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
  muteUser(userId: string, durationSeconds?: number): Promise<void>;
  unmuteUser(userId: string): Promise<void>;
  setRoomMute(enabled: boolean): Promise<void>;
}

export class LiveRoomState implements LiveRoom {
  private readonly emitter = new TypedEventEmitter<LiveRoomEventMap>();
  private readonly reducer = new RoomEventReducer();
  private connectionState: RoomConnectionState = 'idle';
  private snapshot: RoomSnapshot | null = null;
  private onlineCount: number | null = null;

  constructor(private readonly delegate: RoomDelegate) {}

  get id(): string {
    return this.snapshot?.id ?? '';
  }

  get state(): RoomConnectionState {
    return this.connectionState;
  }

  get info(): RoomSnapshot | null {
    return this.snapshot;
  }

  get messages(): readonly RoomMessage[] {
    return this.reducer.snapshotMessages();
  }

  get online(): number | null {
    return this.onlineCount;
  }

  open(): Promise<void> {
    return this.delegate.connect();
  }

  refreshInfo(): Promise<RoomSnapshot> {
    return this.delegate.refreshInfo();
  }

  refreshMedia(): Promise<readonly MediaSource[]> {
    return this.delegate.refreshMedia();
  }

  loadPreviousMessages(cursor?: string): Promise<MessagePage> {
    return this.delegate.loadPreviousMessages(cursor);
  }

  sendComment(text: string): Promise<PendingMessage> {
    return this.delegate.sendComment(text);
  }

  sendLike(count?: number): Promise<void> {
    return this.delegate.sendLike(count);
  }

  deleteComment(messageId: string, reason?: string): Promise<void> {
    return this.delegate.deleteComment(messageId, reason);
  }

  muteUser(userId: string, durationSeconds?: number): Promise<void> {
    return this.delegate.muteUser(userId, durationSeconds);
  }

  unmuteUser(userId: string): Promise<void> {
    return this.delegate.unmuteUser(userId);
  }

  setRoomMute(enabled: boolean): Promise<void> {
    return this.delegate.setRoomMute(enabled);
  }

  on<T extends RoomEventName>(event: T, handler: RoomEventHandler<T>): () => void {
    return this.emitter.on(event, handler);
  }

  close(): Promise<void> {
    return this.delegate.close();
  }

  replaceSnapshot(snapshot: RoomSnapshot, sequence?: number | null): void {
    this.snapshot = snapshot;
    this.reducer.reset(sequence);
  }

  updateSnapshot(snapshot: RoomSnapshot): void {
    this.snapshot = snapshot;
  }

  setState(next: RoomConnectionState): void {
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

  setOnline(online: number | null): void {
    this.onlineCount = online;
    this.emitter.emit('online.changed', { online });
  }

  setRoomStatus(status: string): void {
    if (!this.snapshot) {
      return;
    }

    this.snapshot.status = status;
    this.emitter.emit('room.status.changed', {
      room: this.snapshot
    });
  }

  beginSync(sequence?: number | null): void {
    this.reducer.beginBuffering(sequence);
  }

  applyRealtimeEvent(event: RealtimeEnvelope): void {
    this.emitReducerEvents(this.reducer.applyRealtimeEvent(event, this.requireSnapshot()));
  }

  drainBufferedEvents(): void {
    this.emitReducerEvents(this.reducer.drainBufferedEvents(this.requireSnapshot()));
  }

  trackPending(message: PendingMessage): void {
    this.reducer.trackPending(message);
  }

  getLastSequence(): number | null {
    return this.reducer.getLastSequence();
  }

  emitError(error: Error): void {
    this.emitter.emit('error', { error });
  }

  private emitReducerEvents(events: ReducerEmission[]): void {
    for (const event of events) {
      this.emitter.emit(event.name, event.payload as never);
    }
  }

  private requireSnapshot(): RoomSnapshot | null {
    if (!this.snapshot) {
      return null;
    }
    return this.snapshot;
  }

  requireCapability(capability: string): void {
    if (!this.snapshot) {
      throw new LiveRoomSdkError({
        code: 'AUTHENTICATION_REQUIRED',
        message: 'The room is not ready yet.'
      });
    }

    void capability;
  }
}
