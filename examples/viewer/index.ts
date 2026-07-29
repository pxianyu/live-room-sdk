import { createLiveRoomSdk } from '@company/live-room-sdk';

const sdk = createLiveRoomSdk({
  apiBaseUrl: 'https://open.example.com',
  auth: {
    type: 'ticket',
    ticket: 'viewer-ticket'
  }
});

sdk.room.on('message.created', ({ message }) => {
  console.log('viewer message', message.author.nickname, message.content.text);
});

sdk.room.on('online.changed', ({ online }) => {
  console.log('viewer online', online);
});

await sdk.connect();
