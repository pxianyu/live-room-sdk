import assert from 'node:assert/strict';

import { createLiveRoomSdk } from '../../dist/index.js';

if (process.env.LIVE_ROOM_SDK_RUN_REALTIME_INTEGRATION !== '1') {
  console.log('Skipped. Set LIVE_ROOM_SDK_RUN_REALTIME_INTEGRATION=1 to run the direct H5 realtime check.');
  process.exit(0);
}

const apiBaseUrl = process.env.LIVE_ROOM_API_BASE_URL;
const accessToken = process.env.LIVE_ROOM_ACCESS_TOKEN;
const websocketUrl = process.env.LIVE_ROOM_WEBSOCKET_URL;
const uniacid = process.env.LIVE_ROOM_UNIACID;
const liveId = process.env.LIVE_ROOM_ID;

assert.ok(apiBaseUrl, 'LIVE_ROOM_API_BASE_URL is required.');
assert.ok(accessToken, 'LIVE_ROOM_ACCESS_TOKEN is required.');
assert.ok(websocketUrl, 'LIVE_ROOM_WEBSOCKET_URL is required.');
assert.ok(uniacid, 'LIVE_ROOM_UNIACID is required.');
assert.ok(liveId, 'LIVE_ROOM_ID is required.');

const sdk = createLiveRoomSdk({ apiBaseUrl, accessToken, websocketUrl, uniacid, liveId });
const liveInfo = await sdk.live.getInfo();
assert.equal(liveInfo.status, 200, 'Original H5 live detail request should succeed.');

const user = liveInfo.data.userInfo;
const chatConfig = liveInfo.data.chatConfig;
assert.ok(user?.id && user?.nickname, 'Original H5 live detail should contain userInfo.');
assert.equal(chatConfig?.authorization?.mode, 'otp', 'Original H5 live detail should use GoEasy OTP authorization.');
assert.ok(
  chatConfig?.host && chatConfig.authorization.client_key && chatConfig.authorization.otp,
  'Original H5 live detail should contain the GoEasy Client Key and one-time OTP.',
);

let opened = false;
const viewing = sdk.realtime.connectViewing(user, { onOpen: () => { opened = true; } });
const chat = await sdk.realtime.connectGoEasy(chatConfig, user);

await new Promise((resolve) => setTimeout(resolve, 1500));
assert.equal(opened, true, 'Original ws1 viewing connection should open.');

await chat.close();
viewing.close();
await sdk.close();
console.log('Direct H5 realtime integration test passed.');
