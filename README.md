# `@company/live-room-sdk`

浏览器直播间 SDK，复用直播平台已有 H5 API、GoEasy 频道和 `/ws1/` 观看协议。

它提供：

- 原 H5 HTTP 客户端和直播间高频方法；
- 原 H5 明文直播详情与业务响应；
- GoEasy OTP 连接、消息解析、发布和在线成员查询；
- `/ws1/` 进入、心跳、离开和自动重连；
- 页面销毁时统一释放实时连接。

SDK 不创建 ticket 或第二套直播接口，不保存 AppSecret，也不把直播间和消息复制到第三方数据库。

## 接入流程

```text
第三方浏览器 -> 第三方服务端
第三方服务端 -> company/live-open-sdk-php -> 同步当前用户
第三方服务端 -> 浏览器：access_token、api_base_url、websocket_url、uniacid
浏览器 -> @company/live-room-sdk -> 原 H5 API / GoEasy / ws1
```

`AppKey/AppSecret` 必须只在第三方服务端使用。浏览器 SDK 只接收当前登录用户的 H5 凭据。

## 环境要求

- 支持 ESM 的构建环境；
- `fetch`、`URL`、`WebSocket`；
- H5/浏览器环境使用 GoEasy，包管理器会安装 `goeasy@2.14.8`。

## 安装

```bash
npm install @company/live-room-sdk
```

```bash
pnpm add @company/live-room-sdk
```

## 快速开始

第三方服务端返回用户凭据后创建实例：

```ts
import { createLiveRoomSdk } from '@company/live-room-sdk';

const sdk = createLiveRoomSdk({
  apiBaseUrl: credential.api_base_url,
  accessToken: credential.access_token,
  uniacid: credential.uniacid,
  liveId: 2685,
  websocketUrl: credential.websocket_url,
});

const response = await sdk.live.getInfo();
if (response.status !== 200) {
  throw new Error(response.msg ?? response.message ?? '直播间加载失败');
}

const liveData = response.data;
```

凭据结构：

```ts
interface LiveCredential {
  access_token: string;
  expires_time: number;
  api_base_url: string;  // https://merchant.example.com/api/{uniacid}/1
  websocket_url: string; // wss://merchant.example.com/ws1/
  uniacid: number;
  type: 1;
}
```

SDK 不写入 `localStorage` 或 `sessionStorage`。页面卸载时必须释放连接：

```ts
onUnmounted(() => {
  void sdk.close();
});
```

## 初始化参数

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `apiBaseUrl` | 是 | 用户同步响应中的原 H5 API 根地址 |
| `accessToken` | 是 | 当前登录用户的原 H5 token |
| `uniacid` | 是 | 商户 ID |
| `liveId` | 是 | 当前直播间 ID |
| `websocketUrl` | 观看统计时 | 用户同步响应中的 `/ws1/` 地址 |
| `fetch` | 否 | 自定义 `fetch`，便于 SSR、测试或代理 |
| `webSocketFactory` | 否 | 自定义 WebSocket 工厂，便于测试或特殊容器 |

## HTTP API

### 高频直播间方法

```ts
const info = await sdk.live.getInfo();
const publicInfo = await sdk.live.getPublicInfo();
const user = await sdk.live.getUserInfo();
const comments = await sdk.live.getComments({ page: 1, limit: 20 });

await sdk.live.like({ likes: 1 });
await sdk.live.filterComment({ content: '你好', content_type: 1 });
await sdk.live.createComment({
  content: '你好',
  content_type: 1,
  random: String(Date.now()),
});
```

方法与原接口映射：

| SDK 方法 | 原 H5 接口 | 用途 |
| --- | --- | --- |
| `getInfo()` | `GET /live/get-slide-live-info/{liveId}` | 当前用户完整直播详情 |
| `getPublicInfo()` | `GET /live/get-slide-live-info-public/{liveId}` | 公开直播详情 |
| `getIntoInfo()` | `GET /live/into/{liveId}` | 建立用户进入记录 |
| `updateLeave(id)` | `GET /live/update_leave/{id}/{liveId}` | 更新观看/离开记录 |
| `getUserInfo()` | `GET /userinfo` | 当前用户资料 |
| `getComments()` | `GET /comments/get-live-lists/{liveId}` | 直播评论列表 |
| `like()` | `GET /live/likes/{liveId}` | 点赞 |
| `filterComment()` | `POST /comments/filter-content/{liveId}` | 发送前敏感词与发言权限校验 |
| `createComment()` | `POST /comments/store/{liveId}` | 评论落库 |

`getInfo()` 和 `getPublicInfo()` 直接返回原 H5 明文 JSON。常用字段包括 `live`、`userInfo`、`chatConfig`、`recommend_goods`、`recommend_coupons`、奖励、问卷、报名表和营销配置。

当前 H5 的正常观看流程使用详情中的 `live.live_log_id` 连接 `/ws1/`；`getIntoInfo()` 和 `updateLeave()` 只保留给仍使用旧轮询观看记录的页面。

### 调用其他原 H5 接口

`sdk.api` 不维护第二套路由表，直接使用 Apifox 中的原 H5 路径：

```ts
const profile = await sdk.api.get('/userinfo');
const gifts = await sdk.api.getAction('/live-gift');
const goods = await sdk.api.getAction('/goods/get-live-goods', {
  page: 1,
  limit: 20,
});

await sdk.api.postAction('/live/pay_gift', {
  gift_id: 10,
  gift_num: 1,
});

await sdk.api.post('/userinfo/update', {
  nickname: 'Ada',
  gender: '0',
});

await sdk.api.post('/shop/goods/collect/add', {
  id: 1415,
  category: 'goods',
});

const image = new FormData();
image.append('file', file);
await sdk.api.request('POST', '/common/upload/image', { data: image });

const progress = new URLSearchParams({
  course_id: '1001',
  progress_seconds: '60',
  progress_percent: '25',
  duration: '240',
});
await sdk.api.request('POST', '/knowledge/course/progress', {
  data: progress,
});
```

路径规则：

| 方法 | 行为 |
| --- | --- |
| `get/post/put/del(path, data)` | 直接请求 `{apiBaseUrl}{path}` |
| `getAction/postAction(path, data)` | 在路径末尾追加当前 `liveId` |
| `request(method, path, request)` | 自定义 method、query、body、header 和 AbortSignal |

普通对象会按 JSON 发送；`FormData` 和 `URLSearchParams` 会原样发送，SDK 不会错误地补 `application/json`。上传文件时不要手动设置 multipart boundary。

所有请求自动携带原 H5 请求头：

```http
Authori-zation: Bearer {access_token}
```

`getAction('/comments/get-live-lists')` 会请求：

```text
{apiBaseUrl}/comments/get-live-lists/{liveId}
```

不要对路径中已经包含 `liveId` 的接口再次使用 `getAction/postAction`。

完整接口清单：`webman_live/docs/apifox/h5-live-user.openapi.json`。

接口清单覆盖当前 H5 中仍有后端路由的：

| 模块 | 主要能力 |
| --- | --- |
| 直播间 | 详情、进入/离开记录、回放、二维码、店铺和资质 |
| 互动 | 评论、点赞、关注、礼物、投诉、福袋和红包 |
| 营销 | 优惠券、奖励、签到、预约、问卷、报名表和奖品兑换 |
| 商品 | 商品分类、商品列表、讲解、完整详情、收藏、新旧购物车兼容入口和直播购买辅助 |
| 用户 | 游客登录、资料、手机号、会员、客服、地址、上下级关系和佣金提现 |
| 运营角色 | 在线用户、禁言、拉黑、标签、助手/发言库和分销员直播数据 |
| 知识内容 | 课程、专栏、评论、学习进度、学习中心和直播关联内容 |

H5 源码中仍有导出但后端已无路由的 `live/fullrewards*`、`register/verify`、`address/update`、`broadcast/*` 和 `live/get-agora-token` 不属于可用契约；更新地址改用 `/address/store` 并传 `id`。`menu1/center` 目前只是空数据占位接口，也不对外列为业务能力。

## GoEasy 实时消息

`chatConfig` 和 `userInfo` 来自 `sdk.live.getInfo()`：

```ts
const response = await sdk.live.getInfo();
const { chatConfig, userInfo } = response.data;

const chat = await sdk.realtime.connectGoEasy(chatConfig, userInfo, {
  onMessage(message) {
    console.log(message.content_type, message.content);
  },
  onPresence(event) {
    console.log('在线成员变化', event);
  },
  onError(error) {
    console.error('GoEasy 错误', error);
  },
});
```

`chatConfig.authorization` 使用 OTP 模式：

```ts
{
  host: string;
  authorization: {
    mode: 'otp';
    client_key: string;
    otp: string;
  };
}
```

浏览器不会取得 GoEasy Secret Key。`connectGoEasy()` 使用一次性 OTP 连接，以 `liveId` 为频道订阅消息和 Presence。

发布消息：

```ts
await chat.publish({
  content: '你好',
  content_type: 1,
  nickname: userInfo.nickname,
  avatar: userInfo.avatar,
  user_id: userInfo.id,
  random: Date.now(),
});

const onlineUsers = await chat.getOnlineUsers();
await chat.close();
```

发送评论必须保持原 H5 顺序：

```ts
const message = {
  content: '你好',
  content_type: 1,
  nickname: userInfo.nickname,
  avatar: userInfo.avatar,
  user_id: userInfo.id,
  random: Date.now(),
};

await sdk.live.filterComment(message);
await chat.publish(message);
await sdk.live.createComment(message);
```

如果只有原始 GoEasy 回调，可单独解析：

```ts
import { parseGoEasyMessage } from '@company/live-room-sdk';

const message = parseGoEasyMessage(rawMessage);
```

### `content_type`

SDK 导出 `LIVE_CONTENT_TYPE` 和 `messageType()`：

```ts
import {
  LIVE_CONTENT_TYPE,
  messageType,
} from '@company/live-room-sdk';

if (messageType(message) === LIVE_CONTENT_TYPE.PURCHASE_NOTIFICATION) {
  // 处理购买通知
}
```

主要消息：

| 常量 | 值 | 含义 |
| --- | ---: | --- |
| `CHAT_MESSAGE` | 1 | 聊天 |
| `GIFT_MESSAGE` | 4 | 礼物 |
| `FOLLOW_MESSAGE` | 5 | 关注 |
| `VIEWER_COUNT` | 6 | 观看人数 |
| `RED_PACKET_MESSAGE` | 7 | 红包 |
| `LINK_MIC_MESSAGE` | 11 | 连麦 |
| `SHARE_LIVE` | 150 | 分享 |
| `WANT_EXPLANATION` | 152 | 想听讲解 |
| `ONLINE_USERS` | 200 | 在线用户 |
| `PRODUCT_EXPOSURE` | 300 | 商品曝光 |
| `COUPON_MESSAGE` | 330 | 优惠券 |
| `PURCHASE_NOTIFICATION` / `PURCHASE_NOTIFICATION2` | 800 / 801 | 购买通知 |
| `LIKE_MESSAGE` | 802 | 点赞 |
| `BLACKLIST_MESSAGE` | 804 | 拉黑 |
| `MUTE_MESSAGE` | 805 | 禁言 |
| `ANSWER_MESSAGE` | 809 | 问卷答题 |
| `NEXT_LIVE_RESERVATION_EXPOSURE` | 811 | 下一场预约 |
| `LOTTERY_MESSAGE` | 1001 | 抽奖 |
| `FORTUNE_BAG_MESSAGE` | 3018 | 福袋 |
| `SIGN_IN_MESSAGE` | 81002 | 签到 |
| `RESERVATION_FORM_MESSAGE` | 81021 | 报名表 |
| `PINNED_MESSAGE` | 81022 | 置顶消息 |
| `DELETE_CHAT_MESSAGE` | 81026 | 删除评论 |
| `ALL_MUTE_MESSAGE` | 81028 | 全员禁言 |
| `LIVE_END` | 9999 | 直播结束 |
| `LIVE_STATUS_CHANGE` | 110110 | 直播状态变化 |

## 观看 WebSocket

```ts
const viewing = sdk.realtime.connectViewing(
  userInfo,
  {
    onOpen() {
      console.log('观看连接已建立');
    },
    onMessage(message) {
      console.log('观看协议消息', message);
    },
    onReconnecting(attempt) {
      console.log('正在重连', attempt);
    },
    onError(error) {
      console.error(error);
    },
  },
  {
    liveLogId: liveData.live.live_log_id,
    watchScene: 'live',
  },
);
```

回放场景：

```ts
sdk.realtime.connectViewing(userInfo, callbacks, {
  liveLogId: replayLogId,
  watchScene: 'playback',
  materialId,
  fileId,
});
```

连接会自动发送 `enter`，每 2 秒发送 `heartbeat`，关闭时发送 `leave`；非主动断开最多重连 5 次，退避上限 30 秒。

单独关闭：

```ts
viewing.close();
```

关闭当前 SDK 的全部 GoEasy 和 WebSocket 连接：

```ts
await sdk.close();
```

## 错误处理

HTTP 层会在以下情况抛出 `Error`：

- HTTP 状态不是 2xx；
- 响应不是有效 JSON；
- 当前环境没有 `fetch`；
- 缺少 `websocketUrl` 却调用 `connectViewing()`。

H5 业务失败通常仍是 HTTP 200，应同时检查响应 `status`：

```ts
try {
  const response = await sdk.live.getInfo();
  if (response.status !== 200) {
    throw new Error(response.msg ?? response.message ?? '直播业务失败');
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
}
```

## 安全与生命周期

- 不把 `AppSecret`、管理员 token 或 GoEasy Secret Key 传入 SDK。
- 只给当前登录用户返回其自己的 H5 token。
- 不把 token 拼入业务日志或错误上报。
- 页面切换直播间时为新 `liveId` 创建新 SDK，并关闭旧实例。
- 凭据过期后由第三方服务端重新同步用户，再重建 SDK。
- 生产环境必须使用 HTTPS/WSS；本地 `localhost` 使用 HTTP/WS。

按原 H5 页面从鉴权、播放器、评论到销毁的完整实现顺序见 `webman_live/docs/third-party-h5-live-room-integration.md`。

## 开发与测试

```bash
npm run typecheck
npm test
```

真实 HTTP 联调：

```bash
LIVE_ROOM_SDK_RUN_HTTP_INTEGRATION=1 \
LIVE_ROOM_API_BASE_URL=https://merchant.example.com/api/9/1 \
LIVE_ROOM_ACCESS_TOKEN=xxx \
LIVE_ROOM_UNIACID=9 \
LIVE_ROOM_ID=2685 \
node tests/integration/open-platform-http.mjs
```

示例目录：

- `examples/viewer/index.ts`：观众端完整连接；
- `examples/customer-operator/index.ts`：使用用户 token 调用角色受限的原 H5 接口。

管理员 token 和后台接口只能由第三方服务端通过 `company/live-open-sdk-php` 调用，不属于浏览器 SDK。
