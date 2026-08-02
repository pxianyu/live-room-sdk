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

const users = await sdk.api.getAction('/live/get_online_users', {
  page: 1,
  limit: 20,
});

if (users.status !== 200) {
  throw new Error(users.msg ?? users.message ?? '在线用户加载失败');
}

await sdk.api.postAction('/anchor/set-user-shutup', {
  uid: 10086,
  type: 1,
});

await sdk.close();
