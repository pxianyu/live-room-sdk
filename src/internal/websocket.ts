import type { LiveUser, ViewingCallbacks, ViewingConnection, ViewingContext } from '../types.js';

interface ViewingOptions {
  websocketUrl: string;
  accessToken: string;
  uniacid: string | number;
  liveId: string | number;
  user: LiveUser;
  callbacks: ViewingCallbacks;
  context: ViewingContext;
  webSocketFactory?: (url: string) => WebSocket;
}

function socketUrl(options: ViewingOptions): string {
  const url = new URL(options.websocketUrl);
  url.searchParams.set('uniacid', String(options.uniacid));
  url.searchParams.set('live_id', String(options.liveId));
  url.searchParams.set('live_log_id', String(options.context.liveLogId ?? 0));
  url.searchParams.set('watch_scene', options.context.watchScene === 'playback' ? 'playback' : 'live');
  url.searchParams.set('material_id', String(options.context.materialId ?? 0));
  url.searchParams.set('file_id', options.context.fileId ?? '');
  url.searchParams.set('user_type', '0');
  url.searchParams.set('access_token', options.accessToken);
  return url.toString();
}

export function connectViewingSocket(options: ViewingOptions): ViewingConnection {
  let socket: WebSocket | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempts = 0;
  let manualClose = false;
  const context = {
    liveLogId: options.context.liveLogId ?? 0,
    watchScene: options.context.watchScene === 'playback' ? 'playback' : 'live',
    materialId: options.context.materialId ?? 0,
    fileId: options.context.fileId ?? '',
  };

  const send = (message: Record<string, unknown>) => {
    if (socket?.readyState === 1) {
      socket.send(JSON.stringify(message));
    }
  };
  const stopHeartbeat = () => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  };
  const sendLeave = () => send({
    type: 'leave',
    uniacid: options.uniacid,
    live_id: options.liveId,
    live_log_id: context.liveLogId,
    watch_scene: context.watchScene,
    material_id: context.materialId,
    file_id: context.fileId,
    uid: options.user.id,
  });
  const reconnect = () => {
    if (manualClose || reconnectAttempts >= 5) {
      return;
    }
    reconnectAttempts += 1;
    options.callbacks.onReconnecting?.(reconnectAttempts);
    reconnectTimer = setTimeout(open, Math.min(2000 * (2 ** (reconnectAttempts - 1)), 30000));
  };
  const open = () => {
    const factory = options.webSocketFactory ?? ((url: string) => new WebSocket(url));
    const nextSocket = factory(socketUrl(options));
    socket = nextSocket;
    nextSocket.onopen = () => {
      if (socket !== nextSocket) {
        return;
      }
      reconnectAttempts = 0;
      send({
        type: 'enter',
        uniacid: options.uniacid,
        live_id: options.liveId,
        live_log_id: context.liveLogId,
        watch_scene: context.watchScene,
        material_id: context.materialId,
        file_id: context.fileId,
        uid: options.user.id,
        random_user: options.context.randomUser,
      });
      stopHeartbeat();
      heartbeatTimer = setInterval(() => send({
        type: 'heartbeat',
        uniacid: options.uniacid,
        live_id: options.liveId,
        live_log_id: context.liveLogId,
        watch_scene: context.watchScene,
        material_id: context.materialId,
        file_id: context.fileId,
        token: options.accessToken,
        user_type: 0,
      }), 2000);
      options.callbacks.onOpen?.();
    };
    nextSocket.onmessage = (event) => {
      const text = String(event.data ?? '').trim();
      if (text === 'Pong' || text === 'Ping' || text.startsWith('P')) {
        return;
      }
      try {
        options.callbacks.onMessage?.(JSON.parse(text));
      } catch {
        options.callbacks.onMessage?.(event.data);
      }
    };
    nextSocket.onerror = (error) => options.callbacks.onError?.(error);
    nextSocket.onclose = (event) => {
      if (socket !== nextSocket) {
        return;
      }
      socket = null;
      stopHeartbeat();
      options.callbacks.onClose?.(event);
      reconnect();
    };
  };

  open();
  return {
    send,
    close: () => {
      manualClose = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      sendLeave();
      stopHeartbeat();
      socket?.close();
      socket = null;
    },
  };
}
