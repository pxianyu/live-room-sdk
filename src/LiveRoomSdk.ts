import { createLiveApi } from './HttpClient.js';
import { connectGoEasy, parseGoEasyMessage } from './internal/goeasy.js';
import { connectViewingSocket } from './internal/websocket.js';
import type { GoEasyMessage, LiveRoomSdk, LiveRoomSdkOptions } from './types.js';

export const LIVE_CONTENT_TYPE = {
  CHAT_MESSAGE: 1,
  EMPTY_MESSAGE: 2,
  GIFT_MESSAGE: 4,
  FOLLOW_MESSAGE: 5,
  VIEWER_COUNT: 6,
  RED_PACKET_MESSAGE: 7,
  LINK_MIC_MESSAGE: 11,
  SHARE_LIVE: 150,
  WANT_EXPLANATION: 152,
  ONLINE_USERS: 200,
  PRODUCT_EXPOSURE: 300,
  COUPON_MESSAGE: 330,
  PURCHASE_NOTIFICATION: 800,
  PURCHASE_NOTIFICATION2: 801,
  LIKE_MESSAGE: 802,
  BLACKLIST_MESSAGE: 804,
  MUTE_MESSAGE: 805,
  LOTTERY_MESSAGE: 1001,
  FORTUNE_BAG_MESSAGE: 3018,
  SET_TAGS: 6314,
  SIGN_IN_MESSAGE: 81002,
  ANSWER_MESSAGE: 809,
  NEXT_LIVE_RESERVATION_EXPOSURE: 811,
  RESERVATION_FORM_MESSAGE: 81021,
  PINNED_MESSAGE: 81022,
  DELETE_CHAT_MESSAGE: 81026,
  ALL_MUTE_MESSAGE: 81028,
  LIVE_END: 9999,
  LIVE_STATUS_CHANGE: 110110,
  LIVE_BAN: 2099,
} as const;

export { parseGoEasyMessage };

export function createLiveRoomSdk(options: LiveRoomSdkOptions): LiveRoomSdk {
  const apiOptions: {
    baseUrl: string;
    accessToken: string;
    liveId: string | number;
    fetch?: typeof fetch;
  } = {
    baseUrl: options.apiBaseUrl,
    accessToken: options.accessToken,
    liveId: options.liveId,
  };
  if (options.fetch) {
    apiOptions.fetch = options.fetch;
  }
  const api = createLiveApi(apiOptions);
  const goEasyConnections = new Set<Awaited<ReturnType<typeof connectGoEasy>>>();
  const viewingConnections = new Set<ReturnType<typeof connectViewingSocket>>();

  return {
    api,
    live: {
      getInfo: (query) => api.getAction('/live/get-slide-live-info', query),
      getPublicInfo: (query) => api.getAction('/live/get-slide-live-info-public', query),
      getIntoInfo: () => api.getAction('/live/into'),
      updateLeave: (id) => api.getAction(`/live/update_leave/${id}`),
      getUserInfo: () => api.get('/userinfo'),
      getComments: (query) => api.getAction('/comments/get-live-lists', query),
      like: (query) => api.getAction('/live/likes', query),
      filterComment: (data) => api.postAction('/comments/filter-content', data),
      createComment: (data) => api.postAction('/comments/store', data),
    },
    realtime: {
      connectGoEasy: async (config, user, callbacks) => {
        const connection = await connectGoEasy(config, user, options.liveId, callbacks);
        goEasyConnections.add(connection);
        return connection;
      },
      connectViewing: (user, callbacks = {}, context = {}) => {
        if (!options.websocketUrl) {
          throw new Error('缺少 websocket_url');
        }
        const viewingOptions: {
          websocketUrl: string;
          accessToken: string;
          uniacid: string | number;
          liveId: string | number;
          user: typeof user;
          callbacks: typeof callbacks;
          context: typeof context;
          webSocketFactory?: (url: string) => WebSocket;
        } = {
          websocketUrl: options.websocketUrl,
          accessToken: options.accessToken,
          uniacid: options.uniacid,
          liveId: options.liveId,
          user,
          callbacks,
          context,
        };
        if (options.webSocketFactory) {
          viewingOptions.webSocketFactory = options.webSocketFactory;
        }
        const connection = connectViewingSocket(viewingOptions);
        viewingConnections.add(connection);
        return connection;
      },
    },
    close: async () => {
      for (const connection of viewingConnections) {
        connection.close();
      }
      viewingConnections.clear();
      await Promise.all([...goEasyConnections].map((connection) => connection.close()));
      goEasyConnections.clear();
    },
  };
}

export function messageType(message: GoEasyMessage): number | undefined {
  return typeof message.content_type === 'number' ? message.content_type : undefined;
}
