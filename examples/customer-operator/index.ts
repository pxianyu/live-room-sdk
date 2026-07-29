import { createLiveRoomSdk } from '@company/live-room-sdk';

const sdk = createLiveRoomSdk({
  apiBaseUrl: 'https://open.example.com',
  auth: {
    type: 'ticket',
    ticket: 'operator-ticket'
  }
});

sdk.room.on('message.created', ({ message }) => {
  console.log('operator saw message', message.messageId);
});

await sdk.connect();
await sdk.room.deleteComment('msg_01', 'operator_action');
