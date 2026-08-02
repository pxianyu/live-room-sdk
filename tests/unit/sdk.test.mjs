import test from 'node:test';
import assert from 'node:assert/strict';

import { createLiveRoomSdk, parseGoEasyMessage } from '../../dist/index.js';

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('uses the original H5 path and Authori-zation header', async () => {
  let requestUrl = '';
  let requestHeaders;
  const sdk = createLiveRoomSdk({
    apiBaseUrl: 'https://merchant.example/api/9/1',
    accessToken: 'user-token',
    uniacid: 9,
    liveId: 42,
    fetch: async (url, init) => {
      requestUrl = String(url);
      requestHeaders = new Headers(init.headers);
      return jsonResponse({ status: 200, data: { likes: 1 } });
    },
  });

  const response = await sdk.api.getAction('/live/likes', { likes: 1 });

  assert.equal(requestUrl, 'https://merchant.example/api/9/1/live/likes/42?likes=1');
  assert.equal(requestHeaders.get('Authori-zation'), 'Bearer user-token');
  assert.deepEqual(response.data, { likes: 1 });
});

test('parses the original GoEasy JSON message payload', () => {
  assert.deepEqual(
    parseGoEasyMessage({ content: '{"content_type":800,"content":"paid"}' }),
    { content_type: 800, content: 'paid' },
  );
});

test('returns plaintext live info from the original H5 endpoint', async () => {
  const sdk = createLiveRoomSdk({
    apiBaseUrl: 'https://merchant.example/api/9/1',
    accessToken: 'user-token',
    uniacid: 9,
    liveId: 42,
    fetch: async () => jsonResponse({ status: 200, data: { live: { id: 42 } } }),
  });

  const response = await sdk.live.getInfo();

  assert.deepEqual(response.data, { live: { id: 42 } });
});

test('opens the original ws1 protocol with H5 enter and leave messages', () => {
  const socket = {
    readyState: 1,
    sent: [],
    closeCalled: false,
    send(message) {
      this.sent.push(JSON.parse(message));
    },
    close() {
      this.closeCalled = true;
    },
  };
  const sdk = createLiveRoomSdk({
    apiBaseUrl: 'https://merchant.example/api/9/1',
    accessToken: 'user-token',
    uniacid: 9,
    liveId: 42,
    websocketUrl: 'wss://merchant.example/ws1/',
    webSocketFactory: (url) => {
      assert.match(url, /uniacid=9/);
      assert.match(url, /live_id=42/);
      assert.match(url, /access_token=user-token/);
      return socket;
    },
  });

  const connection = sdk.realtime.connectViewing({ id: 7, nickname: 'viewer' });
  socket.onopen();
  connection.close();

  assert.equal(socket.sent[0].type, 'enter');
  assert.equal(socket.sent[1].type, 'leave');
  assert.equal(socket.closeCalled, true);
});
