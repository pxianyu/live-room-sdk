import { LiveRoomSdkError } from '../errors.js';
function describeGoEasyError(error) {
    if (error instanceof Error) {
        return error.message;
    }
    if (typeof error === 'object' && error !== null) {
        const details = error;
        return String(details.content ?? details.message ?? details.code ?? 'unknown error');
    }
    return String(error ?? 'unknown error');
}
function parseRealtimePayload(content) {
    if (!content) {
        return null;
    }
    if (typeof content === 'string') {
        return JSON.parse(content);
    }
    return content;
}
function wrapGoEasyError(code, error) {
    return new LiveRoomSdkError({
        code,
        message: describeGoEasyError(error),
        retryable: true,
        cause: error
    });
}
export async function connectGoEasy(runtime, credential, onEvent, logger) {
    let instance;
    try {
        const module = await runtime.loadGoEasy();
        instance = module.getInstance({
            host: credential.host,
            appkey: credential.client_key,
            modules: ['pubsub']
        });
    }
    catch (error) {
        throw wrapGoEasyError('GOEASY_CONNECT_FAILED', error);
    }
    try {
        await new Promise((resolve, reject) => {
            instance.connect({
                id: credential.connect_id,
                otp: credential.otp,
                onSuccess: resolve,
                onFailed: reject
            });
        });
    }
    catch (error) {
        throw wrapGoEasyError('GOEASY_CONNECT_FAILED', error);
    }
    try {
        await new Promise((resolve, reject) => {
            instance.pubsub.subscribe({
                channel: credential.channel,
                accessToken: credential.access_token,
                onMessage: (message) => {
                    try {
                        const payload = parseRealtimePayload(message.content);
                        if (payload) {
                            onEvent(payload);
                        }
                    }
                    catch (error) {
                        logger?.warn?.('Discarded invalid GoEasy payload', {
                            error: error instanceof Error ? error.message : String(error)
                        });
                    }
                },
                onSuccess: resolve,
                onFailed: reject
            });
        });
    }
    catch (error) {
        await new Promise((resolve) => {
            if (typeof instance.disconnect !== 'function') {
                resolve();
                return;
            }
            instance.disconnect({
                onSuccess: resolve,
                onFailed: () => resolve()
            });
        });
        throw wrapGoEasyError('GOEASY_SUBSCRIBE_FAILED', error);
    }
    return {
        async close() {
            await new Promise((resolve) => {
                if (typeof instance.pubsub.unsubscribe !== 'function') {
                    resolve();
                    return;
                }
                instance.pubsub.unsubscribe({
                    channel: credential.channel,
                    onSuccess: resolve,
                    onFailed: () => resolve()
                });
            });
            await new Promise((resolve) => {
                if (typeof instance.disconnect !== 'function') {
                    resolve();
                    return;
                }
                instance.disconnect({
                    onSuccess: resolve,
                    onFailed: () => resolve()
                });
            });
        }
    };
}
//# sourceMappingURL=goeasy.js.map