import { createLiveRoomSdk } from '@company/live-room-sdk';

declare const adminStore: {
  accessToken: string;
};

const sdk = createLiveRoomSdk({
  apiBaseUrl: '/api',
  roomId: 'room_01',
  auth: {
    type: 'platform-operator',
    getAccessToken: () => adminStore.accessToken
  }
});

await sdk.connect();
await sdk.room.setRoomMute(true);
