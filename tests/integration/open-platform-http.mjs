import assert from 'node:assert/strict';

import { createLiveRoomSdk } from '../../dist/index.js';

if (process.env.LIVE_ROOM_SDK_RUN_HTTP_INTEGRATION !== '1') {
  console.log('Skipped. Set LIVE_ROOM_SDK_RUN_HTTP_INTEGRATION=1 to run the direct H5 HTTP check.');
  process.exit(0);
}

const apiBaseUrl = process.env.LIVE_ROOM_API_BASE_URL;
const accessToken = process.env.LIVE_ROOM_ACCESS_TOKEN;
const uniacid = process.env.LIVE_ROOM_UNIACID;
const liveId = process.env.LIVE_ROOM_ID;

assert.ok(apiBaseUrl, 'LIVE_ROOM_API_BASE_URL is required.');
assert.ok(accessToken, 'LIVE_ROOM_ACCESS_TOKEN is required.');
assert.ok(uniacid, 'LIVE_ROOM_UNIACID is required.');
assert.ok(liveId, 'LIVE_ROOM_ID is required.');

const sdk = createLiveRoomSdk({ apiBaseUrl, accessToken, uniacid, liveId });
const response = await sdk.live.getInfo();

assert.equal(response.status, 200, 'Original H5 live detail request should succeed.');
assert.ok(response.data.live, 'Original H5 live detail should contain live data.');

console.log('Direct H5 HTTP integration test passed.');
