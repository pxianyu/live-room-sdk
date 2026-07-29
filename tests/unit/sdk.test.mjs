import test from 'node:test';
import assert from 'node:assert/strict';

import { LiveRoomSdkImpl } from '../../dist/LiveRoomSdk.js';
import { connectGoEasy } from '../../dist/internal/goeasy.js';

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
  await Promise.all([sdk.refresh(), sdk.refresh()]);

  assert.equal(operatorSessionCalls, 1);
  assert.equal(bootstrapCalls, 2);
  assert.equal(realtimeCalls, 2);
  assert.equal(createdSockets.length, 0);
  assert.equal(goeasyInstance.connectCalls.length, 2);

  await sdk.close();
});

test('connect degrades catch-up when message history is not available but keeps explicit history errors', async () => {
  const timers = new FakeTimers();
  const goeasyInstance = new MockGoEasyInstance();
  const fetchCalls = [];

  const fetchImpl = async (input) => {
    const url = new URL(String(input));
    fetchCalls.push({
      path: url.pathname,
      search: url.search
    });

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

  const { runtime } = createRuntime({
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

  await sdk.connect();

  assert.equal(sdk.room.state, 'ready');
  assert.equal(sdk.room.id, 'room_history_off');
  assert.equal(sdk.room.online, 9);
  assert.equal(sdk.room.messages.length, 0);
  assert.equal(
    fetchCalls.filter((call) => call.path === '/sdk/v1/rooms/current/messages' && call.search === '?after_sequence=4').length,
    1
  );

  await assert.rejects(
    () => sdk.room.loadPreviousMessages(),
    (error) =>
      error?.name === 'LiveRoomSdkError' &&
      error.code === 'FEATURE_NOT_AVAILABLE' &&
      error.status === 501 &&
      error.message === 'Room message history is not enabled for this release'
  );

  await sdk.close();
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
