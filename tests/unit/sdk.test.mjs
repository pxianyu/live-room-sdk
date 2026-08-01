import test from 'node:test';
import assert from 'node:assert/strict';

import { HttpClient } from '../../dist/HttpClient.js';
import { LiveRoomState } from '../../dist/LiveRoom.js';
import { LiveRoomSdkImpl } from '../../dist/LiveRoomSdk.js';
import { connectGoEasy } from '../../dist/internal/goeasy.js';
import { ViewerWebSocketTransport } from '../../dist/internal/websocket.js';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json'
    }
  });
}

class FakeTimers {
  constructor() {
    this.time = Date.parse('2026-07-26T12:00:00.000Z');
    this.timeoutId = 0;
    this.intervalId = 0;
    this.timeouts = new Map();
    this.intervals = new Map();
  }

  now = () => this.time;

  setTimeout = (callback, delay) => {
    const id = ++this.timeoutId;
    this.timeouts.set(id, { callback, delay });
    return id;
  };

  clearTimeout = (id) => {
    this.timeouts.delete(id);
  };

  setInterval = (callback, delay) => {
    const id = ++this.intervalId;
    this.intervals.set(id, { callback, delay });
    return id;
  };

  clearInterval = (id) => {
    this.intervals.delete(id);
  };

  runInterval(id) {
    this.intervals.get(id)?.callback();
  }

  runAllIntervals() {
    for (const entry of this.intervals.values()) {
      entry.callback();
    }
  }
}

class MockWebSocket {
  static OPEN = 1;
  static CLOSED = 3;

  constructor(url, autoReadyPayload) {
    this.url = url;
    this.autoReadyPayload = autoReadyPayload;
    this.readyState = MockWebSocket.OPEN;
    this.sent = [];
    this.closeCalls = 0;
    this.listeners = {
      open: new Set(),
      message: new Set(),
      close: new Set(),
      error: new Set()
    };

    queueMicrotask(() => this.emit('open', {}));
  }

  addEventListener(type, listener) {
    this.listeners[type].add(listener);
  }

  removeEventListener(type, listener) {
    this.listeners[type].delete(listener);
  }

  send(payload) {
    const parsed = JSON.parse(payload);
    this.sent.push(parsed);
    if (parsed.type === 'room.auth' && this.autoReadyPayload) {
      queueMicrotask(() => {
        this.emit('message', {
          data: JSON.stringify(this.autoReadyPayload)
        });
      });
    }
  }

  close(code = 1000) {
    this.closeCalls += 1;
    this.readyState = MockWebSocket.CLOSED;
    this.emit('close', { code });
  }

  emit(type, event) {
    for (const listener of this.listeners[type]) {
      if (typeof listener === 'function') {
        listener(event);
      } else {
        listener.handleEvent(event);
      }
    }
  }
}

class MockGoEasyInstance {
  constructor(autoMessage) {
    this.autoMessage = autoMessage;
    this.connectCalls = [];
    this.subscribeCalls = [];
    this.unsubscribeCalls = [];
    this.disconnectCalls = 0;
    this.messageHandler = null;
  }

  connect(options) {
    this.connectCalls.push(options);
    options.onSuccess();
  }

  disconnect(options) {
    this.disconnectCalls += 1;
    options?.onSuccess?.();
  }

  pubsub = {
    subscribe: (options) => {
      this.subscribeCalls.push(options);
      this.messageHandler = options.onMessage;
      options.onSuccess();
      if (this.autoMessage) {
        queueMicrotask(() => {
          this.messageHandler?.({
            content: JSON.stringify(this.autoMessage)
          });
        });
      }
    },
    unsubscribe: (options) => {
      this.unsubscribeCalls.push(options);
      options.onSuccess?.();
    }
  };

  emitMessage(event) {
    this.messageHandler?.({
      content: JSON.stringify(event)
    });
  }
}

function createRuntime({ fetchImpl, timers, goeasyInstance, websocketReadyPayload, ids = [] }) {
  const createdSockets = [];
  let idIndex = 0;

  return {
    runtime: {
      fetch: fetchImpl,
      loadGoEasy: async () => ({
        getInstance: () => goeasyInstance
      }),
      createWebSocket: (url) => {
        const socket = new MockWebSocket(url, websocketReadyPayload);
        createdSockets.push(socket);
        return socket;
      },
      now: timers.now,
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
      setInterval: timers.setInterval,
      clearInterval: timers.clearInterval,
      createId: (prefix) => ids[idIndex++] ?? `${prefix}_${idIndex}`
    },
    createdSockets
  };
}

test('relative API base preserves the configured path prefix', async () => {
  let requestedUrl = '';
  const client = new HttpClient({
    baseUrl: '/api',
    fetch: async (url) => {
      requestedUrl = String(url);
      return jsonResponse({ data: { items: [] }, request_id: 'req_relative_base' });
    }
  });

  const response = await client.request({
    method: 'GET',
    path: '/sdk/v1/rooms/room_1/messages',
    query: { after_sequence: 7 }
  });

  assert.equal(requestedUrl, '/api/sdk/v1/rooms/room_1/messages?after_sequence=7');
  assert.equal(response.requestId, 'req_relative_base');
});

test('SDK preserves a server validation error code', async () => {
  const client = new HttpClient({
    baseUrl: 'https://open.example.test',
    fetch: async () => jsonResponse({
      status: 40002,
      request_id: 'req_validation_error',
      data: null,
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Comment text is required'
      }
    }, 422)
  });

  await assert.rejects(
    () => client.request({ method: 'POST', path: '/sdk/v1/rooms/current/commands/comments' }),
    (error) =>
      error?.code === 'VALIDATION_FAILED'
      && error?.businessCode === 40002
      && error?.requestId === 'req_validation_error'
  );
});

test('a terminal room event changes the SDK state to ended', () => {
  const room = new LiveRoomState({
    connect: async () => {},
    refresh: async () => {},
    close: async () => {},
    refreshInfo: async () => room.info,
    refreshMedia: async () => [],
    loadPreviousMessages: async () => ({ messages: [], hasMore: false }),
    sendComment: async () => {
      throw new Error('not used');
    },
    sendLike: async () => {},
    deleteComment: async () => {},
    muteUser: async () => {},
    unmuteUser: async () => {},
    setRoomMute: async () => {}
  });

  room.replaceSnapshot({ id: 'room_terminal', status: 'LIVE' }, 3);
  room.setState('ready');
  room.applyRealtimeEvent({
    event_id: 'evt_terminal',
    event_type: 'room.status.changed.v1',
    sequence: 4,
    data: { status: 'STOPPED' }
  });

  assert.equal(room.info?.status, 'STOPPED');
  assert.equal(room.state, 'ended');
});

test('a terminal bootstrap snapshot ends without requesting realtime credentials', async () => {
  const timers = new FakeTimers();
  const goeasyInstance = new MockGoEasyInstance();
  let realtimeCredentialRequests = 0;

  const fetchImpl = async (input) => {
    const url = new URL(String(input));

    if (url.pathname === '/sdk/v1/sessions/exchange') {
      return jsonResponse({
        data: {
          session_id: 'ses_stopped',
          role: 'viewer',
          access_token: 'session_stopped',
          expires_at: '2026-07-26T12:30:00.000Z'
        },
        request_id: 'req_exchange'
      });
    }

    if (url.pathname === '/sdk/v1/rooms/current/bootstrap') {
      return jsonResponse({
        data: {
          user: {
            id: 'usr_stopped',
            nickname: 'Stopped viewer',
            role: 'viewer',
            capabilities: ['room:view', 'message:read']
          },
          room: {
            id: 'room_stopped',
            status: 'STOPPED',
            current_sequence: 3
          }
        },
        request_id: 'req_bootstrap'
      });
    }

    if (url.pathname === '/sdk/v1/rooms/current/realtime-credential') {
      realtimeCredentialRequests += 1;
      throw new Error('Stopped rooms must not request realtime credentials.');
    }

    if (url.pathname === '/sdk/v1/sessions/current') {
      return jsonResponse({ data: null, request_id: 'req_close' });
    }

    throw new Error(`Unhandled request: ${url.pathname}`);
  };

  const { runtime, createdSockets } = createRuntime({
    fetchImpl,
    timers,
    goeasyInstance
  });
  const sdk = new LiveRoomSdkImpl(
    {
      apiBaseUrl: 'https://api.example.test',
      auth: {
        type: 'ticket',
        ticket: 'ticket_stopped'
      }
    },
    { runtime }
  );

  await sdk.connect();

  assert.equal(sdk.room.state, 'ended');
  assert.equal(realtimeCredentialRequests, 0);
  assert.equal(goeasyInstance.connectCalls.length, 0);
  assert.equal(createdSockets.length, 0);

  await sdk.close();
});

test('GoEasy initialization failures retain the public connect error code', async () => {
  const runtime = {
    loadGoEasy: async () => ({
      getInstance: () => {
        throw { code: 'UNSUPPORTED_RUNTIME', content: 'GoEasy requires a browser runtime' };
      }
    })
  };

  await assert.rejects(
    connectGoEasy(
      runtime,
      {
        host: 'hangzhou.goeasy.io',
        client_key: 'client_key',
        connect_id: 'connection_1',
        otp: 'otp_1',
        channel: 'protected-room_1',
        access_token: 'access_token_1',
        expires_at: '2026-07-26T12:10:00.000Z'
      },
      () => {}
    ),
    (error) => error?.code === 'GOEASY_CONNECT_FAILED'
  );
});

test('GoEasy synchronous connect failures retain the public connect error code', async () => {
  const runtime = {
    loadGoEasy: async () => ({
      getInstance: () => ({
        connect: () => {
          throw { code: 'UNSUPPORTED_RUNTIME', content: 'GoEasy requires a browser runtime' };
        },
        pubsub: {
          subscribe: () => {}
        }
      })
    })
  };

  await assert.rejects(
    connectGoEasy(
      runtime,
      {
        host: 'hangzhou.goeasy.io',
        client_key: 'client_key',
        connect_id: 'connection_1',
        otp: 'otp_1',
        channel: 'protected-room_1',
        access_token: 'access_token_1',
        expires_at: '2026-07-26T12:10:00.000Z'
      },
      () => {}
    ),
    (error) => error?.code === 'GOEASY_CONNECT_FAILED'
  );
});

test('viewer websocket close cancels a pending ready handshake', async () => {
  const timers = new FakeTimers();
  const createdSockets = [];
  const transport = new ViewerWebSocketTransport(
    {
      createWebSocket: (url) => {
        const socket = new MockWebSocket(url, null);
        createdSockets.push(socket);
        return socket;
      },
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
      setInterval: timers.setInterval,
      clearInterval: timers.clearInterval
    },
    async () => ({ url: 'wss://example.test/ws/open-room', ticket: 'ws_ticket_1' }),
    {
      onReady: () => {},
      onOnlineChanged: () => {},
      onRoomStatusChanged: () => {},
      onError: () => {},
      onReconnecting: () => {}
    },
    {
      id: 'room_1',
      title: undefined,
      status: 'LIVE',
      likeCount: undefined,
      muted: undefined,
      notice: undefined,
      features: undefined,
      playback: undefined
    }
  );

  const opening = transport.open();
  await Promise.resolve();
  await transport.close();

  await assert.rejects(opening, (error) => error?.code === 'SDK_CLOSED');
  assert.equal(createdSockets[0].closeCalls, 1);
  assert.equal(timers.timeouts.size, 0);
});

test('viewer websocket close during credential loading does not create a socket', async () => {
  const timers = new FakeTimers();
  const createdSockets = [];
  let resolveCredential;
  const credential = new Promise((resolve) => {
    resolveCredential = resolve;
  });
  const transport = new ViewerWebSocketTransport(
    {
      createWebSocket: (url) => {
        const socket = new MockWebSocket(url, null);
        createdSockets.push(socket);
        return socket;
      },
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
      setInterval: timers.setInterval,
      clearInterval: timers.clearInterval
    },
    () => credential,
    {
      onReady: () => {},
      onOnlineChanged: () => {},
      onRoomStatusChanged: () => {},
      onError: () => {},
      onReconnecting: () => {}
    },
    {
      id: 'room_1',
      title: undefined,
      status: 'LIVE',
      likeCount: undefined,
      muted: undefined,
      notice: undefined,
      features: undefined,
      playback: undefined
    }
  );

  const opening = transport.open();
  await transport.close();
  resolveCredential({ url: 'wss://example.test/ws/open-room', ticket: 'ws_ticket_1' });

  await assert.rejects(opening, (error) => error?.code === 'SDK_CLOSED');
  assert.equal(createdSockets.length, 0);
});

test('a stopped room websocket does not schedule another connection', async () => {
  const timers = new FakeTimers();
  const createdSockets = [];
  const room = { id: 'room_stopped', status: 'LIVE' };
  const transport = new ViewerWebSocketTransport(
    {
      createWebSocket: (url) => {
        const socket = new MockWebSocket(url, null);
        createdSockets.push(socket);
        return socket;
      },
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
      setInterval: timers.setInterval,
      clearInterval: timers.clearInterval
    },
    async () => ({ url: 'wss://example.test/ws/open-room', ticket: 'ws_ticket_stopped' }),
    {
      onReady: () => {},
      onOnlineChanged: () => {},
      onRoomStatusChanged: () => {},
      onError: () => {},
      onReconnecting: () => {
        throw new Error('stopped rooms must not reconnect');
      }
    },
    room
  );

  const opening = transport.open();
  await Promise.resolve();
  createdSockets[0].emit('message', {
    data: JSON.stringify({ type: 'room.ready', room: { online: 1 } })
  });
  await opening;

  createdSockets[0].emit('message', {
    data: JSON.stringify({ type: 'room.status.changed', status: 'STOPPED' })
  });
  createdSockets[0].close(1000);

  assert.equal(room.status, 'STOPPED');
  assert.equal(timers.timeouts.size, 0);
});

test('catch-up follows every page and applies like totals from REST and realtime events', async () => {
  const timers = new FakeTimers();
  const goeasyInstance = new MockGoEasyInstance();
  const fetchCalls = [];
  let afterSequenceCalls = 0;

  const fetchImpl = async (input) => {
    const url = new URL(String(input));
    fetchCalls.push(`${url.pathname}${url.search}`);

    if (url.pathname === '/sdk/v1/sessions/exchange') {
      return jsonResponse({
        data: {
          session_id: 'ses_pages',
          role: 'viewer',
          access_token: 'session_pages',
          expires_at: '2026-07-26T12:30:00.000Z'
        },
        request_id: 'req_exchange'
      });
    }

    if (url.pathname === '/sdk/v1/rooms/current/bootstrap') {
      return jsonResponse({
        data: {
          user: {
            id: 'usr_pages',
            nickname: 'Viewer',
            role: 'viewer',
            capabilities: ['message:read', 'message:send']
          },
          room: {
            id: 'room_pages',
            status: 'LIVE',
            sequence: 10,
            like_count: 2
          }
        },
        request_id: 'req_bootstrap'
      });
    }

    if (url.pathname === '/sdk/v1/rooms/current/realtime-credential') {
      return jsonResponse({
        data: {
          goeasy: {
            host: 'hangzhou.goeasy.io',
            client_key: 'client_key',
            connect_id: 'conn_pages',
            otp: 'otp_pages',
            channel: 'protected-room-pages',
            access_token: 'goeasy_pages'
          }
        },
        request_id: 'req_realtime'
      });
    }

    if (url.pathname === '/sdk/v1/rooms/current/messages' && !url.searchParams.has('after_sequence')) {
      return jsonResponse({
        data: {
          messages: [{
            message_id: 'msg_history',
            sequence: 8,
            author: { id: 'usr_history', nickname: 'History' },
            content: { type: 'text', text: 'history' },
            created_at: '2026-07-26T11:59:00.000Z'
          }],
          has_more: false
        },
        request_id: 'req_history'
      });
    }

    if (url.pathname === '/sdk/v1/rooms/current/messages') {
      afterSequenceCalls += 1;
      if (afterSequenceCalls === 1) {
        return jsonResponse({
          data: {
            events: [{
              event_id: 'evt_like',
              event_type: 'engagement.like.delta.v1',
              sequence: 11,
              occurred_at: '2026-07-26T12:00:01.000Z',
              data: { count: 3, total: 5, user_id: 'usr_pages' }
            }],
            next_sequence: 11,
            has_more: true
          },
          request_id: 'req_gap_1'
        });
      }

      return jsonResponse({
        data: {
          events: [{
            event_id: 'evt_message',
            event_type: 'chat.message.created.v1',
            sequence: 12,
            occurred_at: '2026-07-26T12:00:02.000Z',
            data: {
              message_id: 'msg_gap',
              author: { id: 'usr_pages', nickname: 'Viewer' },
              content: { type: 'text', text: 'gap message' }
            }
          }],
          next_sequence: 12,
          has_more: false
        },
        request_id: 'req_gap_2'
      });
    }

    if (url.pathname === '/sdk/v1/rooms/current/commands/likes') {
      return jsonResponse({
        data: {
          event_id: 'evt_like_command',
          sequence: 13,
          count: 2,
          total: 7
        },
        request_id: 'req_like'
      });
    }

    if (url.pathname === '/sdk/v1/sessions/current') {
      return jsonResponse({ data: null, request_id: 'req_close' });
    }

    throw new Error(`Unhandled request: ${url.pathname}${url.search}`);
  };

  const { runtime } = createRuntime({
    fetchImpl,
    timers,
    goeasyInstance,
    websocketReadyPayload: null,
    ids: ['cr_like']
  });
  const sdk = new LiveRoomSdkImpl(
    {
      apiBaseUrl: 'https://api.example.test',
      auth: { type: 'ticket', ticket: 'ticket_pages' }
    },
    { runtime }
  );

  await sdk.connect();
  assert.equal(sdk.room.messages.length, 2);
  assert.equal(sdk.room.info?.likeCount, 5);
  assert.equal(afterSequenceCalls, 2);
  assert.deepEqual(
    fetchCalls.filter((call) => call.startsWith('/sdk/v1/rooms/current/messages?after_sequence=')),
    [
      '/sdk/v1/rooms/current/messages?after_sequence=10',
      '/sdk/v1/rooms/current/messages?after_sequence=11'
    ]
  );

  let likeEvents = 0;
  sdk.room.on('like.changed', () => {
    likeEvents += 1;
  });
  await sdk.room.sendLike(2);
  assert.equal(sdk.room.info?.likeCount, 7);
  assert.equal(likeEvents, 1);

  goeasyInstance.emitMessage({
    event_id: 'evt_like_command',
    event_type: 'engagement.like.delta.v1',
    sequence: 13,
    data: { count: 2, total: 7, user_id: 'usr_pages' }
  });
  assert.equal(likeEvents, 1);

  goeasyInstance.emitMessage({
    event_id: 'evt_room_stopped',
    event_type: 'room.status.changed.v1',
    sequence: 14,
    data: { status: 'STOPPED' }
  });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(sdk.room.state, 'ended');
  assert.equal(goeasyInstance.disconnectCalls, 1);

  await sdk.close();
});

test('viewer connect wires GoEasy, websocket auth, heartbeat, and message dedupe', async () => {
  const timers = new FakeTimers();
  const fetchCalls = [];
  const goeasyInstance = new MockGoEasyInstance({
    event_id: 'evt_buffered',
    event_type: 'chat.message.created.v1',
    sequence: 11,
    occurred_at: '2026-07-26T12:00:01.000Z',
    data: {
      message_id: 'msg_buffered',
      author: { id: 'usr_viewer', nickname: 'Viewer' },
      content: { type: 'text', text: 'buffered message' }
    }
  });

  const fetchImpl = async (input, init) => {
    const url = new URL(String(input));
    fetchCalls.push({
      path: url.pathname,
      search: url.search,
      method: init?.method ?? 'GET'
    });

    if (url.pathname === '/sdk/v1/sessions/exchange') {
      return jsonResponse({
        data: {
          session_id: 'ses_1',
          role: 'viewer',
          access_token: 'session_token',
          expires_at: '2026-07-26T12:30:00.000Z'
        },
        request_id: 'req_exchange'
      });
    }

    if (url.pathname === '/sdk/v1/rooms/current/bootstrap') {
      return jsonResponse({
        data: {
          user: {
            id: 'usr_viewer',
            nickname: 'Viewer',
            role: 'viewer',
            capabilities: ['message:read', 'message:send']
          },
          room: {
            id: 'room_1',
            title: 'Demo',
            status: 'LIVE',
            sequence: 10,
            playback: {
              mode: 'live',
              sources: [{ protocol: 'hls', url: 'https://cdn/live.m3u8' }]
            }
          },
          realtime: {
            credential_url: '/sdk/v1/rooms/current/realtime-credential',
            ws_url: 'wss://example.test/ws/open-room'
          }
        },
        request_id: 'req_bootstrap'
      });
    }

    if (url.pathname === '/sdk/v1/rooms/current/realtime-credential') {
      return jsonResponse({
        data: {
          goeasy: {
            host: 'hangzhou.goeasy.io',
            client_key: 'client_key',
            connect_id: 'conn_1',
            otp: 'otp_1',
            channel: 'protected-room-1',
            access_token: 'goeasy_token'
          },
          websocket: {
            url: 'wss://example.test/ws/open-room',
            ticket: 'ws_ticket_1'
          }
        },
        request_id: 'req_rt'
      });
    }

    if (url.pathname === '/sdk/v1/rooms/current/messages' && !url.searchParams.has('after_sequence')) {
      return jsonResponse({
        data: {
          messages: [],
          has_more: false
        },
        request_id: 'req_history'
      });
    }

    if (url.pathname === '/sdk/v1/rooms/current/messages' && url.searchParams.get('after_sequence') === '10') {
      return jsonResponse({
        data: {
          events: [
            {
              event_id: 'evt_buffered',
              event_type: 'chat.message.created.v1',
              sequence: 11,
              occurred_at: '2026-07-26T12:00:01.000Z',
              data: {
                message_id: 'msg_buffered',
                author: { id: 'usr_viewer', nickname: 'Viewer' },
                content: { type: 'text', text: 'buffered message' }
              }
            }
          ]
        },
        request_id: 'req_gap'
      });
    }

    if (url.pathname === '/sdk/v1/rooms/current/messages') {
      return jsonResponse({
        data: {
          events: [],
          next_sequence: Number(url.searchParams.get('after_sequence') ?? 0),
          has_more: false
        },
        request_id: 'req_gap_empty'
      });
    }

    if (url.pathname === '/sdk/v1/rooms/current/commands/comments') {
      return jsonResponse({
        data: {
          message_id: 'msg_echo'
        },
        request_id: 'req_comment'
      });
    }

    if (url.pathname === '/sdk/v1/sessions/current') {
      return jsonResponse({ data: null, request_id: 'req_close' });
    }

    throw new Error(`Unhandled request: ${url.pathname}${url.search}`);
  };

  const { runtime, createdSockets } = createRuntime({
    fetchImpl,
    timers,
    goeasyInstance,
    websocketReadyPayload: {
      type: 'room.ready',
      heartbeat_interval: 15,
      room: { id: 'room_1', online: 128 }
    },
    ids: ['cr_1', 'pending_1']
  });

  const sdk = new LiveRoomSdkImpl(
    {
      apiBaseUrl: 'https://api.example.test',
      auth: {
        type: 'ticket',
        ticket: 'ticket_1'
      }
    },
    { runtime }
  );

  await sdk.connect();

  assert.equal(sdk.user.id, 'usr_viewer');
  assert.equal(sdk.room.id, 'room_1');
  assert.equal(sdk.room.online, 128);
  assert.equal(sdk.room.messages.length, 1);
  assert.equal(sdk.room.messages[0].messageId, 'msg_buffered');
  assert.equal(goeasyInstance.connectCalls[0].otp, 'otp_1');
  assert.equal(goeasyInstance.subscribeCalls[0].accessToken, 'goeasy_token');
  assert.deepEqual(createdSockets[0].sent[0], {
    type: 'room.auth',
    ticket: 'ws_ticket_1',
    protocol_version: '1.0'
  });
  createdSockets[0].emit('message', {
    data: JSON.stringify({
      type: 'room.online.changed',
      room_id: 'room_1',
      online: 129
    })
  });
  assert.equal(sdk.room.online, 129);

  timers.runAllIntervals();
  assert.deepEqual(createdSockets[0].sent.at(-1), { type: 'room.heartbeat' });

  const pending = await sdk.room.sendComment('hello');
  assert.equal(pending.state, 'accepted');
  assert.equal(sdk.room.messages.length, 2);

  goeasyInstance.emitMessage({
    event_id: 'evt_echo',
    event_type: 'chat.message.created.v1',
    sequence: 12,
    occurred_at: '2026-07-26T12:00:02.000Z',
    data: {
      message_id: 'msg_echo',
      client_request_id: 'cr_1',
      author: { id: 'usr_viewer', nickname: 'Viewer' },
      content: { type: 'text', text: 'hello' }
    }
  });
  goeasyInstance.emitMessage({
    event_id: 'evt_echo',
    event_type: 'chat.message.created.v1',
    sequence: 12,
    occurred_at: '2026-07-26T12:00:02.000Z',
    data: {
      message_id: 'msg_echo',
      client_request_id: 'cr_1',
      author: { id: 'usr_viewer', nickname: 'Viewer' },
      content: { type: 'text', text: 'hello' }
    }
  });

  assert.equal(sdk.room.messages.length, 2);
  assert.equal(sdk.room.messages[1].state, 'committed');
  assert.equal(
    fetchCalls.filter((call) => call.path === '/sdk/v1/rooms/current/messages' && call.search === '?after_sequence=10').length,
    1
  );

  let websocketErrors = 0;
  sdk.room.on('error', () => {
    websocketErrors += 1;
  });
  createdSockets[0].emit('message', {
    data: JSON.stringify({
      type: 'room.kicked',
      reason: 'session_revoked_or_expired'
    })
  });
  await Promise.resolve();
  assert.equal(websocketErrors, 1);
  assert.equal(timers.timeouts.size, 0);

  await sdk.close();
});

test('platform operator refresh is single-flight and does not open viewer websocket', async () => {
  const timers = new FakeTimers();
  const goeasyInstance = new MockGoEasyInstance();
  let operatorSessionCalls = 0;
  let bootstrapCalls = 0;
  let realtimeCalls = 0;

  const fetchImpl = async (input, init) => {
    const url = new URL(String(input));

    if (url.pathname === '/sdk/v1/rooms/room_operator/operator-session') {
      operatorSessionCalls += 1;
      return jsonResponse({
        data: {
          session_id: `ses_operator_${operatorSessionCalls}`,
          role: 'operator',
          access_token: `operator_session_${operatorSessionCalls}`,
          expires_at: '2026-07-26T12:30:00.000Z'
        },
        request_id: `req_operator_${operatorSessionCalls}`
      });
    }

    if (url.pathname === '/sdk/v1/rooms/current/bootstrap') {
      bootstrapCalls += 1;
      return jsonResponse({
        data: {
          user: {
            id: 'usr_operator',
            nickname: 'Operator',
            role: 'operator',
            capabilities: ['message:read', 'message:send', 'message:delete', 'user:mute', 'room:mute']
          },
          room: {
            id: 'room_operator',
            title: 'Ops room',
            status: 'LIVE',
            sequence: 20
          },
          realtime: {
            credential_url: '/sdk/v1/rooms/current/realtime-credential',
            ws_url: 'wss://example.test/ws/open-room'
          }
        },
        request_id: `req_bootstrap_${bootstrapCalls}`
      });
    }

    if (url.pathname === '/sdk/v1/rooms/current/realtime-credential') {
      realtimeCalls += 1;
      return jsonResponse({
        data: {
          goeasy: {
            host: 'hangzhou.goeasy.io',
            client_key: 'client_key',
            connect_id: `conn_${realtimeCalls}`,
            otp: `otp_${realtimeCalls}`,
            channel: 'protected-room-operator',
            access_token: `goeasy_${realtimeCalls}`
          }
        },
        request_id: `req_rt_${realtimeCalls}`
      });
    }

    if (url.pathname === '/sdk/v1/rooms/current/messages') {
      return jsonResponse({
        data: {
          events: []
        },
        request_id: 'req_gap'
      });
    }

    if (url.pathname === '/sdk/v1/sessions/current') {
      return jsonResponse({ data: null, request_id: 'req_close' });
    }

    throw new Error(`Unhandled request: ${url.pathname}`);
  };

  const { runtime, createdSockets } = createRuntime({
    fetchImpl,
    timers,
    goeasyInstance,
    websocketReadyPayload: null
  });

  const sdk = new LiveRoomSdkImpl(
    {
      apiBaseUrl: 'https://api.example.test',
      roomId: 'room_operator',
      auth: {
        type: 'platform-operator',
        getAccessToken: () => 'platform_admin_token'
      }
    },
    { runtime }
  );

  await sdk.connect();
  await Promise.all([sdk.refresh(), sdk.refresh(), sdk.connect()]);

  assert.equal(operatorSessionCalls, 1);
  assert.equal(bootstrapCalls, 2);
  assert.equal(realtimeCalls, 2);
  assert.equal(createdSockets.length, 0);
  assert.equal(goeasyInstance.connectCalls.length, 2);

  await sdk.close();
});

test('concurrent operator 401 responses refresh the session only once', async () => {
  const timers = new FakeTimers();
  const goeasyInstance = new MockGoEasyInstance();
  let operatorSessionCalls = 0;
  let rejectStaleToken = false;

  const fetchImpl = async (input, init = {}) => {
    const url = new URL(String(input));
    const authorization = init.headers?.Authorization ?? '';

    if (url.pathname === '/sdk/v1/rooms/room_operator/operator-session') {
      operatorSessionCalls += 1;
      return jsonResponse({
        data: {
          session_id: `ses_operator_${operatorSessionCalls}`,
          role: 'operator',
          access_token: `operator_session_${operatorSessionCalls}`,
          expires_at: '2026-07-26T12:30:00.000Z'
        },
        request_id: `req_operator_${operatorSessionCalls}`
      });
    }

    if (url.pathname === '/sdk/v1/rooms/current/bootstrap') {
      if (rejectStaleToken && authorization === 'Bearer operator_session_1') {
        return jsonResponse({ error: { code: 'SESSION_EXPIRED', message: 'expired' } }, 401);
      }
      return jsonResponse({
        data: {
          user: {
            id: 'usr_operator',
            nickname: 'Operator',
            role: 'operator',
            capabilities: ['message:read']
          },
          room: { id: 'room_operator', status: 'LIVE', sequence: 20 }
        },
        request_id: 'req_bootstrap'
      });
    }

    if (url.pathname === '/sdk/v1/rooms/current/realtime-credential') {
      return jsonResponse({
        data: {
          goeasy: {
            host: 'hangzhou.goeasy.io',
            client_key: 'client_key',
            connect_id: `conn_${operatorSessionCalls}`,
            otp: `otp_${operatorSessionCalls}`,
            channel: 'protected-room-operator',
            access_token: `goeasy_${operatorSessionCalls}`
          }
        },
        request_id: 'req_realtime'
      });
    }

    if (url.pathname === '/sdk/v1/rooms/current/messages') {
      return jsonResponse({ data: { messages: [], events: [], has_more: false }, request_id: 'req_messages' });
    }

    if (url.pathname === '/sdk/v1/rooms/current/refresh-media') {
      if (authorization === 'Bearer operator_session_1') {
        return jsonResponse({ error: { code: 'SESSION_EXPIRED', message: 'expired' } }, 401);
      }
      return jsonResponse({ data: { sources: [] }, request_id: 'req_media' });
    }

    if (url.pathname === '/sdk/v1/sessions/current') {
      return jsonResponse({ data: null, request_id: 'req_close' });
    }

    throw new Error(`Unhandled request: ${url.pathname}`);
  };

  const { runtime } = createRuntime({
    fetchImpl,
    timers,
    goeasyInstance,
    websocketReadyPayload: null
  });
  const sdk = new LiveRoomSdkImpl(
    {
      apiBaseUrl: 'https://api.example.test',
      roomId: 'room_operator',
      auth: {
        type: 'platform-operator',
        getAccessToken: () => 'platform_admin_token'
      }
    },
    { runtime }
  );

  await sdk.connect();
  rejectStaleToken = true;
  await Promise.all([sdk.room.refreshInfo(), sdk.room.refreshMedia()]);

  assert.equal(operatorSessionCalls, 2);
  await sdk.close();
});

test('close aborts an in-flight SDK request', async () => {
  const timers = new FakeTimers();
  const goeasyInstance = new MockGoEasyInstance();
  let aborted = false;

  const fetchImpl = async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.pathname !== '/sdk/v1/sessions/exchange') {
      throw new Error(`Unhandled request: ${url.pathname}`);
    }

    return new Promise((resolve, reject) => {
      init.signal?.addEventListener('abort', () => {
        aborted = true;
        reject(new DOMException('Request aborted', 'AbortError'));
      });
    });
  };

  const { runtime } = createRuntime({
    fetchImpl,
    timers,
    goeasyInstance,
    websocketReadyPayload: null
  });
  const sdk = new LiveRoomSdkImpl(
    {
      apiBaseUrl: 'https://api.example.test',
      auth: { type: 'ticket', ticket: 'ticket_abort' }
    },
    { runtime }
  );

  const opening = sdk.connect();
  await Promise.resolve();
  await sdk.close();

  await assert.rejects(opening, (error) => error?.code === 'SDK_CLOSED');
  assert.equal(aborted, true);
});

test('viewer ticket exchange is shared by a direct room request and connect', async () => {
  const timers = new FakeTimers();
  const goeasyInstance = new MockGoEasyInstance();
  let exchangeCalls = 0;
  let resolveExchange;
  const exchangeResponse = new Promise((resolve) => {
    resolveExchange = resolve;
  });

  const fetchImpl = async (input) => {
    const url = new URL(String(input));

    if (url.pathname === '/sdk/v1/sessions/exchange') {
      exchangeCalls += 1;
      return exchangeResponse;
    }

    if (url.pathname === '/sdk/v1/rooms/current/bootstrap') {
      return jsonResponse({
        data: {
          user: {
            id: 'usr_shared_ticket',
            nickname: 'Viewer',
            role: 'viewer',
            capabilities: ['room:view', 'message:read']
          },
          room: {
            id: 'room_shared_ticket',
            status: 'PUBLISHED',
            sequence: 0
          }
        },
        request_id: 'req_bootstrap'
      });
    }

    if (url.pathname === '/sdk/v1/rooms/current/realtime-credential') {
      return jsonResponse({
        data: null,
        error: {
          code: 'GOEASY_CONNECT_FAILED',
          message: 'Realtime unavailable'
        }
      }, 503);
    }

    if (url.pathname === '/sdk/v1/rooms/current/messages') {
      return jsonResponse({
        data: { messages: [], events: [], has_more: false },
        request_id: 'req_messages'
      });
    }

    if (url.pathname === '/sdk/v1/sessions/current') {
      return jsonResponse({ data: null, request_id: 'req_close' });
    }

    throw new Error(`Unhandled request: ${url.pathname}`);
  };

  const { runtime } = createRuntime({
    fetchImpl,
    timers,
    goeasyInstance,
    websocketReadyPayload: null
  });
  const sdk = new LiveRoomSdkImpl(
    {
      apiBaseUrl: 'https://api.example.test',
      auth: { type: 'ticket', ticket: 'ticket_shared' }
    },
    { runtime }
  );

  const info = sdk.room.refreshInfo();
  await Promise.resolve();
  const opening = sdk.connect();
  resolveExchange(jsonResponse({
    data: {
      session_id: 'ses_shared_ticket',
      role: 'viewer',
      access_token: 'session_shared_ticket',
      expires_at: '2026-07-26T12:30:00.000Z'
    },
    request_id: 'req_exchange'
  }));

  await Promise.all([info, opening]);
  assert.equal(exchangeCalls, 1);
  assert.equal(sdk.room.id, 'room_shared_ticket');

  await sdk.close();
});

test('connect propagates a message-history failure', async () => {
  const timers = new FakeTimers();
  const goeasyInstance = new MockGoEasyInstance();

  const fetchImpl = async (input) => {
    const url = new URL(String(input));

    if (url.pathname === '/sdk/v1/sessions/exchange') {
      return jsonResponse({
        data: {
          session_id: 'ses_history_off',
          role: 'viewer',
          access_token: 'session_history_off',
          expires_at: '2026-07-26T12:30:00.000Z'
        },
        request_id: 'req_exchange'
      });
    }

    if (url.pathname === '/sdk/v1/rooms/current/bootstrap') {
      return jsonResponse({
        data: {
          user: {
            id: 'usr_history_off',
            nickname: 'Viewer',
            role: 'viewer',
            capabilities: ['message:read']
          },
          room: {
            id: 'room_history_off',
            status: 'LIVE',
            sequence: 4
          },
          realtime: {
            credential_url: '/sdk/v1/rooms/current/realtime-credential',
            ws_url: 'wss://example.test/ws/open-room'
          }
        },
        request_id: 'req_bootstrap'
      });
    }

    if (url.pathname === '/sdk/v1/rooms/current/realtime-credential') {
      return jsonResponse({
        data: {
          goeasy: {
            host: 'hangzhou.goeasy.io',
            client_key: 'client_key',
            connect_id: 'conn_history_off',
            otp: 'otp_history_off',
            channel: 'protected-room-history-off',
            access_token: 'goeasy_history_off'
          },
          websocket: {
            url: 'wss://example.test/ws/open-room',
            ticket: 'ws_ticket_history_off'
          }
        },
        request_id: 'req_rt'
      });
    }

    if (url.pathname === '/sdk/v1/rooms/current/messages') {
      return jsonResponse(
        {
          data: null,
          request_id: 'req_history_off',
          error: {
            code: 'FEATURE_NOT_AVAILABLE',
            message: 'Room message history is not enabled for this release'
          }
        },
        501
      );
    }

    if (url.pathname === '/sdk/v1/sessions/current') {
      return jsonResponse({ data: null, request_id: 'req_close' });
    }

    throw new Error(`Unhandled request: ${url.pathname}${url.search}`);
  };

  const { runtime, createdSockets } = createRuntime({
    fetchImpl,
    timers,
    goeasyInstance,
    websocketReadyPayload: {
      type: 'room.ready',
      heartbeat_interval: 15,
      room: { id: 'room_history_off', online: 9 }
    }
  });

  const sdk = new LiveRoomSdkImpl(
    {
      apiBaseUrl: 'https://api.example.test',
      auth: {
        type: 'ticket',
        ticket: 'ticket_history_off'
      }
    },
    { runtime }
  );

  await assert.rejects(
    () => sdk.connect(),
    (error) =>
      error?.name === 'LiveRoomSdkError' &&
      error.code === 'NETWORK_ERROR' &&
      error.status === 501 &&
      error.message === 'Room message history is not enabled for this release'
  );

  assert.equal(sdk.room.state, 'error');
  assert.equal(goeasyInstance.unsubscribeCalls.length, 1);
  assert.equal(goeasyInstance.disconnectCalls, 1);
  assert.equal(createdSockets.length, 1);
  assert.equal(createdSockets[0].closeCalls, 1);
});

test('connect keeps the room usable when realtime credentials are unavailable', async () => {
  const timers = new FakeTimers();
  const goeasyInstance = new MockGoEasyInstance();
  let deleteSessionCalls = 0;

  const fetchImpl = async (input) => {
    const url = new URL(String(input));

    if (url.pathname === '/sdk/v1/sessions/exchange') {
      return jsonResponse({
        data: {
          session_id: 'ses_realtime_unavailable',
          role: 'viewer',
          access_token: 'session_realtime_unavailable',
          expires_at: '2026-07-26T12:30:00.000Z'
        },
        request_id: 'req_exchange'
      });
    }

    if (url.pathname === '/sdk/v1/rooms/current/bootstrap') {
      return jsonResponse({
        data: {
          user: {
            id: 'usr_realtime_unavailable',
            nickname: 'Viewer',
            role: 'viewer',
            capabilities: ['room:view']
          },
          room: {
            id: 'room_realtime_unavailable',
            status: 'LIVE',
            sequence: 1,
            playback: {
              mode: 'live',
              sources: [{ protocol: 'hls', url: 'https://cdn.example.test/live.m3u8' }]
            }
          }
        },
        request_id: 'req_bootstrap'
      });
    }

    if (url.pathname === '/sdk/v1/rooms/current/realtime-credential') {
      return jsonResponse({
        data: null,
        request_id: 'req_realtime_unavailable',
        error: {
          code: 'GOEASY_CONNECT_FAILED',
          message: 'Realtime service is not configured'
        }
      }, 503);
    }

    if (url.pathname === '/sdk/v1/rooms/current/messages') {
      return jsonResponse({
        data: {
          messages: [],
          events: [],
          has_more: false
        },
        request_id: 'req_messages'
      });
    }

    if (url.pathname === '/sdk/v1/sessions/current') {
      deleteSessionCalls += 1;
      return jsonResponse({ data: null, request_id: 'req_close' });
    }

    throw new Error(`Unhandled request: ${url.pathname}`);
  };

  const { runtime, createdSockets } = createRuntime({
    fetchImpl,
    timers,
    goeasyInstance,
    websocketReadyPayload: null
  });
  const sdk = new LiveRoomSdkImpl(
    {
      apiBaseUrl: 'https://api.example.test',
      auth: {
        type: 'ticket',
        ticket: 'ticket_realtime_unavailable'
      }
    },
    { runtime }
  );
  const errors = [];
  sdk.room.on('error', (event) => errors.push(event.error));

  await sdk.connect();

  assert.equal(sdk.room.state, 'degraded');
  assert.equal(sdk.room.id, 'room_realtime_unavailable');
  assert.equal(sdk.room.info?.playback?.sources?.[0]?.url, 'https://cdn.example.test/live.m3u8');
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, 'GOEASY_CONNECT_FAILED');
  assert.equal(createdSockets.length, 0);
  assert.equal(goeasyInstance.connectCalls.length, 0);

  await sdk.close();
  assert.equal(deleteSessionCalls, 1);
});

test('close is idempotent and only tears down session and transports once', async () => {
  const timers = new FakeTimers();
  const goeasyInstance = new MockGoEasyInstance();
  let deleteSessionCalls = 0;

  const fetchImpl = async (input) => {
    const url = new URL(String(input));

    if (url.pathname === '/sdk/v1/sessions/exchange') {
      return jsonResponse({
        data: {
          session_id: 'ses_close',
          role: 'viewer',
          access_token: 'session_close',
          expires_at: '2026-07-26T12:30:00.000Z'
        },
        request_id: 'req_exchange'
      });
    }

    if (url.pathname === '/sdk/v1/rooms/current/bootstrap') {
      return jsonResponse({
        data: {
          user: {
            id: 'usr_close',
            nickname: 'Closer',
            role: 'viewer',
            capabilities: ['message:read']
          },
          room: {
            id: 'room_close',
            status: 'LIVE',
            sequence: 1
          },
          realtime: {
            credential_url: '/sdk/v1/rooms/current/realtime-credential',
            ws_url: 'wss://example.test/ws/open-room'
          }
        },
        request_id: 'req_bootstrap'
      });
    }

    if (url.pathname === '/sdk/v1/rooms/current/realtime-credential') {
      return jsonResponse({
        data: {
          goeasy: {
            host: 'hangzhou.goeasy.io',
            client_key: 'client_key',
            connect_id: 'conn_close',
            otp: 'otp_close',
            channel: 'protected-room-close',
            access_token: 'goeasy_close'
          },
          websocket: {
            url: 'wss://example.test/ws/open-room',
            ticket: 'ws_ticket_close'
          }
        },
        request_id: 'req_rt'
      });
    }

    if (url.pathname === '/sdk/v1/rooms/current/messages') {
      return jsonResponse({
        data: {
          events: []
        },
        request_id: 'req_gap'
      });
    }

    if (url.pathname === '/sdk/v1/sessions/current') {
      deleteSessionCalls += 1;
      return jsonResponse({ data: null, request_id: 'req_close' });
    }

    throw new Error(`Unhandled request: ${url.pathname}`);
  };

  const { runtime, createdSockets } = createRuntime({
    fetchImpl,
    timers,
    goeasyInstance,
    websocketReadyPayload: {
      type: 'room.ready',
      heartbeat_interval: 15,
      room: { id: 'room_close', online: 5 }
    }
  });

  const sdk = new LiveRoomSdkImpl(
    {
      apiBaseUrl: 'https://api.example.test',
      auth: {
        type: 'ticket',
        ticket: 'ticket_close'
      }
    },
    { runtime }
  );

  await sdk.connect();
  await Promise.all([sdk.close(), sdk.close()]);

  assert.equal(deleteSessionCalls, 1);
  assert.equal(goeasyInstance.unsubscribeCalls.length, 1);
  assert.equal(goeasyInstance.disconnectCalls, 1);
  assert.equal(createdSockets[0].closeCalls, 1);
  assert.equal(sdk.room.state, 'closed');
});
