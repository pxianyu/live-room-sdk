import type {
  LiveRoomEventMap,
  RealtimeEnvelope,
  RoomMessage,
  RoomSnapshot
} from '../types.js';

export interface ReducerAppliedEvent<TKey extends keyof LiveRoomEventMap> {
  name: TKey;
  payload: LiveRoomEventMap[TKey];
}

export type ReducerEmission = ReducerAppliedEvent<keyof LiveRoomEventMap>;

function normalizeMessage(data: Record<string, unknown>, fallbackCreatedAt: string): RoomMessage {
  const author = (data.author ?? {}) as Record<string, unknown>;
  const content = (data.content ?? {}) as Record<string, unknown>;

  return {
    messageId: String(data.message_id ?? data.messageId ?? ''),
    eventId: typeof data.event_id === 'string' ? data.event_id : undefined,
    clientRequestId:
      typeof data.client_request_id === 'string'
        ? data.client_request_id
        : typeof data.clientRequestId === 'string'
          ? data.clientRequestId
          : undefined,
    sequence: typeof data.sequence === 'number' ? data.sequence : undefined,
    author: {
      id: String(author.id ?? ''),
      nickname: String(author.nickname ?? ''),
      avatarUrl: typeof author.avatar_url === 'string' ? author.avatar_url : undefined
    },
    content: {
      type: 'text',
      text: String(content.text ?? '')
    },
    state: 'committed',
    createdAt:
      typeof data.created_at === 'string'
        ? data.created_at
        : typeof data.createdAt === 'string'
          ? data.createdAt
          : fallbackCreatedAt
  };
}

function insertSortedMessage(messages: RoomMessage[], message: RoomMessage): void {
  const sequence = message.sequence ?? Number.MAX_SAFE_INTEGER;
  const createdAt = message.createdAt;
  const index = messages.findIndex((item) => {
    const itemSequence = item.sequence ?? Number.MAX_SAFE_INTEGER;
    if (itemSequence !== sequence) {
      return itemSequence > sequence;
    }

    return item.createdAt > createdAt;
  });

  if (index === -1) {
    messages.push(message);
    return;
  }

  messages.splice(index, 0, message);
}

export class RoomEventReducer {
  private readonly messages: RoomMessage[] = [];
  private readonly messageIds = new Map<string, RoomMessage>();
  private readonly pendingByRequestId = new Map<string, RoomMessage>();
  private readonly appliedEventIds = new Set<string>();
  private readonly bufferedEvents: RealtimeEnvelope[] = [];
  private buffering = false;
  private lastSequence: number | null = null;

  reset(sequence?: number | null): void {
    this.messages.length = 0;
    this.messageIds.clear();
    this.pendingByRequestId.clear();
    this.appliedEventIds.clear();
    this.bufferedEvents.length = 0;
    this.buffering = false;
    this.lastSequence = sequence ?? null;
  }

  snapshotMessages(): readonly RoomMessage[] {
    return this.messages;
  }

  trackPending(message: RoomMessage): void {
    if (message.clientRequestId) {
      this.pendingByRequestId.set(message.clientRequestId, message);
    }
    insertSortedMessage(this.messages, message);
    this.messageIds.set(message.messageId, message);
  }

  beginBuffering(startSequence?: number | null): void {
    this.buffering = true;
    if (typeof startSequence === 'number') {
      this.lastSequence = startSequence;
    }
  }

  drainBufferedEvents(room: RoomSnapshot | null): ReducerEmission[] {
    this.buffering = false;
    const buffered = this.bufferedEvents.splice(0).sort((left, right) => {
      const leftSequence = left.sequence ?? Number.MAX_SAFE_INTEGER;
      const rightSequence = right.sequence ?? Number.MAX_SAFE_INTEGER;
      return leftSequence - rightSequence;
    });

    const emissions: ReducerEmission[] = [];
    for (const event of buffered) {
      emissions.push(...this.applyRealtimeEvent(event, room));
    }
    return emissions;
  }

  applyRealtimeEvent(event: RealtimeEnvelope, room: RoomSnapshot | null): ReducerEmission[] {
    if (!event.event_type) {
      return [];
    }

    if (this.buffering) {
      this.bufferedEvents.push(event);
      return [];
    }

    if (event.event_id) {
      if (this.appliedEventIds.has(event.event_id)) {
        return [];
      }
      this.appliedEventIds.add(event.event_id);
    }

    if (typeof event.sequence === 'number') {
      this.lastSequence = Math.max(this.lastSequence ?? 0, event.sequence);
    }

    const data = (event.data ?? {}) as Record<string, unknown>;

    switch (event.event_type) {
      case 'chat.message.created.v1':
        return this.applyMessageCreated(event, data);
      case 'chat.message.deleted.v1':
        return this.applyMessageDeleted(data);
      case 'chat.user.muted.v1':
        return [
          {
            name: 'user.muted',
            payload: {
              userId: String(data.user_id ?? ''),
              durationSeconds: typeof data.duration_seconds === 'number' ? data.duration_seconds : undefined,
              expiresAt: typeof data.expires_at === 'string' ? data.expires_at : undefined,
              reason: typeof data.reason === 'string' ? data.reason : undefined
            }
          }
        ];
      case 'chat.room.muted.v1': {
        const enabled = Boolean(data.enabled);
        if (room) {
          room.muted = enabled;
        }
        return [
          {
            name: 'room.muted',
            payload: { enabled }
          }
        ];
      }
      case 'room.notice.updated.v1': {
        const notice = String(data.notice ?? '');
        if (room) {
          room.notice = notice;
        }
        return [
          {
            name: 'notice.updated',
            payload: { notice }
          }
        ];
      }
      case 'room.status.changed.v1': {
        if (room && typeof data.status === 'string') {
          room.status = data.status;
        }
        return room
          ? [
              {
                name: 'room.status.changed',
                payload: { room }
              }
            ]
          : [];
      }
      default:
        return [];
    }
  }

  getLastSequence(): number | null {
    return this.lastSequence;
  }

  private applyMessageCreated(event: RealtimeEnvelope, data: Record<string, unknown>): ReducerEmission[] {
    const message = normalizeMessage(
      {
        ...data,
        event_id: event.event_id,
        sequence: event.sequence
      },
      event.occurred_at ?? new Date().toISOString()
    );

    const existingById = this.messageIds.get(message.messageId);
    const pending =
      message.clientRequestId && this.pendingByRequestId.has(message.clientRequestId)
        ? this.pendingByRequestId.get(message.clientRequestId)
        : undefined;

    const target = pending ?? existingById;
    if (target) {
      target.messageId = message.messageId;
      target.eventId = message.eventId;
      target.sequence = message.sequence;
      target.createdAt = message.createdAt;
      target.author = message.author;
      target.content = message.content;
      target.state = 'committed';
      this.messageIds.set(target.messageId, target);
      if (target.clientRequestId) {
        this.pendingByRequestId.delete(target.clientRequestId);
      }
      return [
        {
          name: 'message.created',
          payload: { message: target }
        }
      ];
    }

    insertSortedMessage(this.messages, message);
    this.messageIds.set(message.messageId, message);

    return [
      {
        name: 'message.created',
        payload: { message }
      }
    ];
  }

  private applyMessageDeleted(data: Record<string, unknown>): ReducerEmission[] {
    const messageId = String(data.message_id ?? '');
    const reason = typeof data.reason === 'string' ? data.reason : undefined;
    const existing = this.messageIds.get(messageId);
    if (existing) {
      existing.state = 'deleted';
    }

    return [
      {
        name: 'message.deleted',
        payload: { messageId, reason }
      }
    ];
  }
}
