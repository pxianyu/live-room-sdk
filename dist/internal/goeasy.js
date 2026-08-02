function errorMessage(error) {
    return error.content ?? error.message ?? String(error.code ?? 'GoEasy 请求失败');
}
function callbackPromise(callback) {
    return new Promise((resolve, reject) => callback(resolve, reject));
}
export function parseGoEasyMessage(value) {
    const content = typeof value === 'object' && value !== null && 'content' in value
        ? value.content
        : value;
    if (typeof content === 'string') {
        return JSON.parse(content);
    }
    if (typeof content === 'object' && content !== null) {
        return content;
    }
    throw new Error('GoEasy 消息格式无效');
}
export async function connectGoEasy(config, user, liveId, callbacks = {}) {
    const imported = await import('goeasy');
    const module = (imported.default ?? imported);
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
            }
            catch (error) {
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
//# sourceMappingURL=goeasy.js.map