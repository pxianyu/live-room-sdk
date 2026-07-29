import assert from 'node:assert/strict';

import { LiveRoomSdkImpl } from '../../dist/LiveRoomSdk.js';

if (process.env.OPEN_PLATFORM_RUN_BROWSER_HTTP_INTEGRATION !== '1') {
  console.log('Skipped. Set OPEN_PLATFORM_RUN_BROWSER_HTTP_INTEGRATION=1 to run the HTTP integration test.');
  process.exit(0);
}

const apiBaseUrl = process.env.OPEN_PLATFORM_BROWSER_BASE_URL;
const ticket = process.env.OPEN_PLATFORM_BROWSER_TICKET;
const roomId = process.env.OPEN_PLATFORM_BROWSER_ROOM_ID;
const origin = process.env.OPEN_PLATFORM_BROWSER_ORIGIN;

assert.ok(apiBaseUrl, 'OPEN_PLATFORM_BROWSER_BASE_URL is required.');
assert.ok(ticket, 'OPEN_PLATFORM_BROWSER_TICKET is required.');
assert.ok(roomId, 'OPEN_PLATFORM_BROWSER_ROOM_ID is required.');
assert.ok(origin, 'OPEN_PLATFORM_BROWSER_ORIGIN is required.');

const sdk = new LiveRoomSdkImpl({
  apiBaseUrl,
  auth: {
    type: 'ticket',
    ticket
  },
  fetch: (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set('Origin', origin);

    return fetch(input, {
      ...init,
      headers
    });
  }
});
const errors = [];
sdk.room.on('error', (event) => errors.push(event.error));

try {
  await sdk.connect();

  assert.equal(sdk.room.id, roomId, 'Browser SDK should bootstrap the ticket room.');
  assert.equal(
    sdk.room.state,
    'degraded',
    'Browser SDK should retain the usable room session when the platform websocket is unavailable.'
  );
  assert.equal(
    errors.length,
    1,
    `Platform websocket failure should emit one room error: ${JSON.stringify(
      errors.map(({ code, message }) => ({ code, message }))
    )}`
  );
  assert.equal(errors[0].code, 'WEBSOCKET_AUTH_FAILED');
} finally {
  await sdk.close();
}

console.log('Open platform browser SDK HTTP integration test passed.');
