import { LiveRoomSdkImpl } from '../../dist/LiveRoomSdk.js';
import { createDefaultRuntime } from '../../dist/internal/runtime.js';

const statusElement = document.querySelector('#status');
const evidenceElement = document.querySelector('#evidence');
const goEasyEvents = [];
const websocketEvents = [];
const sdkErrors = [];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function show(status, evidence) {
  document.documentElement.dataset.status = status.toLowerCase();
  statusElement.textContent = status;
  evidenceElement.textContent = JSON.stringify(evidence, null, 2);
}

async function waitFor(predicate, message, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(message);
}

function parseMessage(content) {
  if (typeof content === 'string') {
    return JSON.parse(content);
  }
  return content;
}

const config = await fetch('./open-platform-realtime-config.json', { cache: 'no-store' }).then((response) => {
  if (!response.ok) {
    throw new Error(`Unable to load integration config (${response.status}).`);
  }
  return response.json();
});
const baseRuntime = createDefaultRuntime(undefined, {
  warn(message) {
    sdkErrors.push(message);
  },
  error(message) {
    sdkErrors.push(message);
  }
});
const realtimeCredentials = [];
const wrappedInstances = new WeakSet();
const runtime = {
  ...baseRuntime,
  async fetch(input, init) {
    const response = await baseRuntime.fetch(input, init);
    if (String(input).includes('realtime-credential')) {
      realtimeCredentials.push(await response.clone().json());
    }
    return response;
  },
  async loadGoEasy() {
    const module = await baseRuntime.loadGoEasy();
    return {
      getInstance(options) {
        const instance = module.getInstance(options);
        if (!wrappedInstances.has(instance)) {
          wrappedInstances.add(instance);
          const subscribe = instance.pubsub.subscribe.bind(instance.pubsub);
          instance.pubsub.subscribe = (subscribeOptions) => subscribe({
            ...subscribeOptions,
            onMessage(message) {
              goEasyEvents.push(parseMessage(message.content));
              subscribeOptions.onMessage(message);
            }
          });
        }
        return instance;
      }
    };
  },
  createWebSocket(url) {
    const socket = baseRuntime.createWebSocket(url);
    socket.addEventListener('message', (event) => {
      const payload = JSON.parse(String(event.data ?? '{}'));
      websocketEvents.push(payload);
    });
    return socket;
  }
};
const sdk = new LiveRoomSdkImpl({
  apiBaseUrl: config.api_base_url,
  auth: {
    type: 'ticket',
    ticket: config.ticket
  }
}, { runtime });
sdk.room.on('error', ({ error }) => {
  sdkErrors.push(`${error.code ?? 'ERROR'}: ${error.message}`);
});

try {
  await sdk.connect();
  assert(sdk.room.state === 'ready', `Expected ready state, got ${sdk.room.state}.`);
  assert(sdk.room.id === config.room_public_id, 'The SDK connected to an unexpected room.');
  assert(websocketEvents.some((event) => event.type === 'room.ready'), 'WebSocket room.ready was not received.');

  const pending = await sdk.room.sendComment(config.comment);
  await waitFor(
    () => goEasyEvents.some((event) => (
      event.event_type === 'chat.message.created.v1'
        && event.data?.content?.text === config.comment
    )),
    'The GoEasy subscriber did not receive the browser comment.'
  );
  await waitFor(
    () => pending.state === 'committed',
    'The SDK did not reconcile the pending comment.'
  );
  await waitFor(
    () => websocketEvents.some((event) => event.type === 'room.heartbeat.ack'),
    'WebSocket heartbeat acknowledgement was not received.',
    25_000
  );

  await sdk.close();
  assert(sdk.room.state === 'closed', 'The SDK did not close its realtime resources.');
  show('PASSED', {
    room_id: config.room_public_id,
    final_state: sdk.room.state,
    goeasy_event_types: goEasyEvents.map((event) => event.event_type),
    websocket_event_types: websocketEvents.map((event) => event.type),
    websocket_url: realtimeCredentials.at(-1)?.data?.websocket?.url ?? null,
    online: sdk.room.online,
    errors: sdkErrors
  });
} catch (error) {
  await sdk.close().catch(() => undefined);
  show('FAILED', {
    message: error instanceof Error ? error.message : String(error),
    sdk_state: sdk.room.state,
    goeasy_event_types: goEasyEvents.map((event) => event.event_type),
    websocket_event_types: websocketEvents.map((event) => event.type),
    websocket_url: realtimeCredentials.at(-1)?.data?.websocket?.url ?? null,
    errors: sdkErrors
  });
}
