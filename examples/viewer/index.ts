import { createLiveRoomSdk } from '@company/live-room-sdk';

declare const credential: {
  api_base_url: string;
  access_token: string;
  websocket_url: string;
  uniacid: number;
};

const sdk = createLiveRoomSdk({
  apiBaseUrl: credential.api_base_url,
  accessToken: credential.access_token,
  websocketUrl: credential.websocket_url,
  uniacid: credential.uniacid,
  liveId: 2685,
});

const response = await sdk.live.getInfo();
if (response.status !== 200) {
  throw new Error(response.msg ?? response.message ?? '直播间加载失败');
}

const { chatConfig, userInfo, live } = response.data as {
  chatConfig: Parameters<typeof sdk.realtime.connectGoEasy>[0];
  userInfo: Parameters<typeof sdk.realtime.connectGoEasy>[1];
  live: { live_log_id: number };
};

const chat = await sdk.realtime.connectGoEasy(chatConfig, userInfo, {
  onMessage(message) {
    console.log('viewer message', message);
  },
  onError(error) {
    console.error(error);
  },
});

sdk.realtime.connectViewing(userInfo, {
  onOpen() {
    console.log('viewing connected');
  },
}, {
  liveLogId: live.live_log_id,
  watchScene: 'live',
});

await sdk.live.like({ likes: 1 });
await chat.getOnlineUsers();

window.addEventListener('pagehide', () => {
  void sdk.close();
});
