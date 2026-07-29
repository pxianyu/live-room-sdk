import { LiveRoomSdkError } from '../errors.js';
let fallbackId = 0;
function defaultCreateId(prefix) {
    const cryptoObject = globalThis.crypto;
    if (cryptoObject?.randomUUID) {
        return `${prefix}_${cryptoObject.randomUUID()}`;
    }
    fallbackId += 1;
    return `${prefix}_${Date.now()}_${fallbackId}`;
}
export function createDefaultRuntime(fetchOverride, logger) {
    const runtimeFetch = fetchOverride ?? globalThis.fetch;
    if (typeof runtimeFetch !== 'function') {
        throw new LiveRoomSdkError({
            code: 'INVALID_RESPONSE',
            message: 'A fetch implementation is required to create the SDK.'
        });
    }
    return {
        fetch: runtimeFetch,
        createWebSocket(url) {
            const WebSocketCtor = globalThis.WebSocket;
            if (typeof WebSocketCtor !== 'function') {
                throw new LiveRoomSdkError({
                    code: 'INVALID_RESPONSE',
                    message: 'WebSocket is not available in the current runtime.'
                });
            }
            return new WebSocketCtor(url);
        },
        async loadGoEasy() {
            const imported = await import('goeasy');
            const candidate = (imported.default ?? imported);
            if (typeof candidate.getInstance !== 'function') {
                logger?.error?.('goeasy module missing getInstance', {});
                throw new LiveRoomSdkError({
                    code: 'INVALID_RESPONSE',
                    message: 'Failed to load the goeasy client.'
                });
            }
            return candidate;
        },
        now: () => Date.now(),
        setTimeout: globalThis.setTimeout.bind(globalThis),
        clearTimeout: globalThis.clearTimeout.bind(globalThis),
        setInterval: globalThis.setInterval.bind(globalThis),
        clearInterval: globalThis.clearInterval.bind(globalThis),
        createId: defaultCreateId
    };
}
//# sourceMappingURL=runtime.js.map