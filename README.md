# `@company/live-room-sdk`

TypeScript ESM browser SDK for live-room viewers and operators. The package only exposes:

- `createLiveRoomSdk(...)`
- `sdk.user`
- `sdk.room`

GoEasy `client_key`, OTP connect, protected channel subscribe, viewer websocket auth,
and reconnect/close lifecycle stay internal. The SDK contract also contains history
and interaction methods for the staged platform rollout.

## Install

```bash
npm install @company/live-room-sdk
```

## Create The SDK

Viewer or customer operator tickets use the same `ticket` auth flow:

```ts
import { createLiveRoomSdk } from '@company/live-room-sdk';

const sdk = createLiveRoomSdk({
  apiBaseUrl: 'https://open.example.com',
  auth: {
    type: 'ticket',
    ticket: oneTimeTicket
  }
});

await sdk.connect();
```

Platform operator sessions exchange the host platform token for a short room session:

```ts
import { createLiveRoomSdk } from '@company/live-room-sdk';

const sdk = createLiveRoomSdk({
  apiBaseUrl: '/api',
  roomId: 'room_01...',
  auth: {
    type: 'platform-operator',
    getAccessToken: () => adminStore.accessToken
  },
  fetch: authenticatedFetch
});

await sdk.connect();
```

`/api/sdk/v1` 是平台后台的同源入口；客户系统应使用开放平台根地址，使 SDK 请求 `/sdk/v1`。

## Public API

```ts
interface LiveRoomSdk {
  readonly user: LiveRoomUser;
  readonly room: LiveRoom;

  connect(): Promise<void>;
  refresh(): Promise<void>;
  close(): Promise<void>;
}
```

```ts
interface LiveRoomUser {
  readonly id: string;
  readonly externalId: string | undefined;
  readonly nickname: string;
  readonly avatarUrl: string | undefined;
  readonly role: 'viewer' | 'operator';
  readonly capabilities: readonly RoomCapability[];
}
```

```ts
interface LiveRoom {
  readonly id: string;
  readonly state: RoomConnectionState;
  readonly info: RoomSnapshot | null;
  readonly messages: readonly RoomMessage[];
  readonly online: number | null;

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
}
```

## Runtime Contract

The SDK expects these endpoints:

- `POST /sdk/v1/sessions/exchange`
- `POST /sdk/v1/rooms/{room_id}/operator-session`
- `GET /sdk/v1/rooms/current/bootstrap`
- `POST /sdk/v1/rooms/current/realtime-credential`
- `GET /sdk/v1/rooms/current/messages?before_cursor=...`
- `GET /sdk/v1/rooms/current/messages?after_sequence=...`
- `POST /sdk/v1/rooms/current/commands/comments`
- `POST /sdk/v1/rooms/current/commands/likes`
- `POST /sdk/v1/rooms/current/commands/delete-comment`
- `POST /sdk/v1/rooms/current/commands/mute-user`
- `POST /sdk/v1/rooms/current/commands/unmute-user`
- `POST /sdk/v1/rooms/current/commands/room-mute`
- `POST /sdk/v1/rooms/current/refresh-media`
- `DELETE /sdk/v1/sessions/current`

## Current Release Availability

Session exchange, bootstrap, protected GoEasy subscription, viewer WebSocket presence,
media refresh, persistent message history, comments, likes, moderation commands, and
session close are available in the current server release. Comment and like commands
are persisted as ordered room events; the browser SDK deduplicates the REST result and
its GoEasy echo by `event_id`.

## Events

```ts
type RoomEventName =
  | 'state.changed'
  | 'room.status.changed'
  | 'online.changed'
  | 'message.created'
  | 'message.deleted'
  | 'like.changed'
  | 'user.muted'
  | 'room.muted'
  | 'notice.updated'
  | 'error';
```

```ts
const unsubscribe = sdk.room.on('message.created', ({ message }) => {
  console.log(message.messageId, message.content.text);
});
```

## Error Handling

`LiveRoomSdkError.status` is the HTTP status. `businessCode` is the numeric business
status returned by the platform, while `code` remains the stable string error identifier.

## Security Boundaries

- The SDK does not expose GoEasy instances, publish, presence, or channel names.
- No ticket, OTP, JWT, or platform access token is written to localStorage/sessionStorage.
- `fetch` and `WebSocket` are resolved at runtime, not at import time.
- Viewer websocket presence is internal and only starts after `room.ready`.
- `close()` is idempotent and shuts down REST session, GoEasy, websocket, retries, and heartbeats.

## Development

```bash
npm install
npm run typecheck
npm test
```
