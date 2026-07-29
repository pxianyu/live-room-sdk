function normalizeMessage(data, fallbackCreatedAt) {
    const author = (data.author ?? {});
    const content = (data.content ?? {});
    return {
        messageId: String(data.message_id ?? data.messageId ?? ''),
        eventId: typeof data.event_id === 'string' ? data.event_id : undefined,
        clientRequestId: typeof data.client_request_id === 'string'
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
        createdAt: typeof data.created_at === 'string'
            ? data.created_at
            : typeof data.createdAt === 'string'
                ? data.createdAt
                : fallbackCreatedAt
    };
}
function insertSortedMessage(messages, message) {
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
    messages = [];
    messageIds = new Map();
    pendingByRequestId = new Map();
    appliedEventIds = new Set();
    bufferedEvents = [];
    buffering = false;
    lastSequence = null;
    reset(sequence) {
        this.messages.length = 0;
        this.messageIds.clear();
        this.pendingByRequestId.clear();
        this.appliedEventIds.clear();
        this.bufferedEvents.length = 0;
        this.buffering = false;
        this.lastSequence = sequence ?? null;
    }
    snapshotMessages() {
        return this.messages;
    }
    trackPending(message) {
        if (message.clientRequestId) {
            this.pendingByRequestId.set(message.clientRequestId, message);
        }
        insertSortedMessage(this.messages, message);
        this.messageIds.set(message.messageId, message);
    }
    beginBuffering(startSequence) {
        this.buffering = true;
        if (typeof startSequence === 'number') {
            this.lastSequence = startSequence;
        }
    }
    drainBufferedEvents(room) {
        this.buffering = false;
        const buffered = this.bufferedEvents.splice(0).sort((left, right) => {
            const leftSequence = left.sequence ?? Number.MAX_SAFE_INTEGER;
            const rightSequence = right.sequence ?? Number.MAX_SAFE_INTEGER;
            return leftSequence - rightSequence;
        });
        const emissions = [];
        for (const event of buffered) {
            emissions.push(...this.applyRealtimeEvent(event, room));
        }
        return emissions;
    }
    applyRealtimeEvent(event, room) {
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
        const data = (event.data ?? {});
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
    getLastSequence() {
        return this.lastSequence;
    }
    applyMessageCreated(event, data) {
        const message = normalizeMessage({
            ...data,
            event_id: event.event_id,
            sequence: event.sequence
        }, event.occurred_at ?? new Date().toISOString());
        const existingById = this.messageIds.get(message.messageId);
        const pending = message.clientRequestId && this.pendingByRequestId.has(message.clientRequestId)
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
    applyMessageDeleted(data) {
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
//# sourceMappingURL=event-reducer.js.map