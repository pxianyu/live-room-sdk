import type { GoEasyCallbacks, GoEasyChatConfig, GoEasyConnection, GoEasyMessage, LiveUser } from '../types.js';

interface GoEasyError {
  code?: string | number;
  content?: string;
  message?: string;
}

interface GoEasyInstance {
  connect(options: { otp: string; id: string; data: Record<string, unknown>; onSuccess: () => void; onFailed: (error: GoEasyError) => void }): void;
  disconnect?(options: { onSuccess: () => void; onFailed: () => void }): void;
  pubsub: {
    subscribe(options: { channel: string; presence: { enable: true }; onMessage: (message: { content: string }) => void; onSuccess: () => void; onFailed: (error: GoEasyError) => void }): void;
    subscribePresence?(options: { channel: string; membersLimit: number; onPresence: (event: unknown) => void; onSuccess: () => void; onFailed: (error: GoEasyError) => void }): void;
    unsubscribe?(options: { channel: string; onSuccess: () => void; onFailed: () => void }): void;
    publish(options: { channel: string; qos: number; message: string; onSuccess: () => void; onFailed: (error: GoEasyError) => void }): void;
    hereNow(options: { channel: string; limit: number; onSuccess: (response: { content: unknown }) => void; onFailed: (error: GoEasyError) => void }): void;
  };
}

interface GoEasyModule {
  getInstance(options: { host: string; appkey: string; modules: ['pubsub'] }): GoEasyInstance;
}

function errorMessage(error: GoEasyError): string {
  return error.content ?? error.message ?? String(error.code ?? 'GoEasy 请求失败');
}

function callbackPromise(callback: (resolve: () => void, reject: (error: GoEasyError) => void) => void): Promise<void> {
  return new Promise((resolve, reject) => callback(resolve, reject));
}

export function parseGoEasyMessage(value: unknown): GoEasyMessage {
  const content = typeof value === 'object' && value !== null && 'content' in value
    ? (value as { content: unknown }).content
    : value;
  if (typeof content === 'string') {
    return JSON.parse(content) as GoEasyMessage;
  }
  if (typeof content === 'object' && content !== null) {
    return content as GoEasyMessage;
  }

  throw new Error('GoEasy 消息格式无效');
}

export async function connectGoEasy(
  config: GoEasyChatConfig,
  user: LiveUser,
  liveId: string | number,
  callbacks: GoEasyCallbacks = {},
): Promise<GoEasyConnection> {
  const imported = await import('goeasy');
  const module = (imported.default ?? imported) as unknown as GoEasyModule;
  const instance = module.getInstance({
    host: config.host,
    appkey: config.authorization.client_key,
    modules: ['pubsub'],
  });
  const channel = String(liveId);
  const userData = {
    id: user.id,
    nickname: user.nickname,
    avatar: user.avatar,
    spid: user.spid ?? 0,
    city: user.city ?? '',
  };

  await callbackPromise((resolve, reject) => instance.connect({
    otp: config.authorization.otp,
    id: String(user.id),
    data: userData,
    onSuccess: resolve,
    onFailed: reject,
  }));
  await callbackPromise((resolve, reject) => instance.pubsub.subscribe({
    channel,
    presence: { enable: true },
    onMessage: (message) => {
      try {
        callbacks.onMessage?.(parseGoEasyMessage(message));
      } catch (error) {
        callbacks.onError?.(error);
      }
    },
    onSuccess: resolve,
    onFailed: reject,
  }));
  if (callbacks.onPresence && instance.pubsub.subscribePresence) {
    instance.pubsub.subscribePresence({
      channel,
      membersLimit: 20,
      onPresence: callbacks.onPresence,
      onSuccess: () => undefined,
      onFailed: (error) => callbacks.onError?.(error),
    });
  }

  return {
    publish: (message) => callbackPromise((resolve, reject) => instance.pubsub.publish({
      channel,
      qos: config.host === 'hangzhou.goeasy.io' ? -1 : 0,
      message: JSON.stringify(message),
      onSuccess: resolve,
      onFailed: reject,
    })),
    getOnlineUsers: () => new Promise((resolve, reject) => instance.pubsub.hereNow({
      channel,
      limit: 20,
      onSuccess: (response) => resolve(response.content),
      onFailed: reject,
    })),
    close: async () => {
      if (instance.pubsub.unsubscribe) {
        await callbackPromise((resolve) => instance.pubsub.unsubscribe?.({ channel, onSuccess: resolve, onFailed: resolve }));
      }
      if (instance.disconnect) {
        await callbackPromise((resolve) => instance.disconnect?.({ onSuccess: resolve, onFailed: resolve }));
      }
    },
  };
}
