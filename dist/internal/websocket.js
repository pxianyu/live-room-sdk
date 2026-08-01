import { LiveRoomSdkError } from '../errors.js';
const READY_TIMEOUT_MS = 10_000;
export class ViewerWebSocketTransport {
    runtime;
    getCredential;
    callbacks;
    room;
    logger;
    socket = null;
    connectPromise = null;
    closed = false;
    socketGeneration = 0;
    reconnectAttempts = 0;
    heartbeatTimer = null;
    reconnectTimer = null;
    detachSocketListeners = null;
    cancelOpen = null;
    constructor(runtime, getCredential, callbacks, room, logger) {
        this.runtime = runtime;
        this.getCredential = getCredential;
        this.callbacks = callbacks;
        this.room = room;
        this.logger = logger;
    }
    open() {
        if (this.closed) {
            return Promise.reject(new LiveRoomSdkError({
                code: 'SDK_CLOSED',
                message: 'The SDK has already been closed.'
            }));
        }
        if (this.connectPromise) {
            return this.connectPromise;
        }
        this.connectPromise = this.connectNextSocket();
        return this.connectPromise;
    }
    async close() {
        this.closed = true;
        this.connectPromise = null;
        this.stopHeartbeat();
        this.clearReconnectTimer();
        this.socketGeneration += 1;
        this.cancelOpen?.(new LiveRoomSdkError({
            code: 'SDK_CLOSED',
            message: 'The SDK has already been closed.'
        }));
        this.cancelOpen = null;
        this.detachSocketListeners?.();
        this.detachSocketListeners = null;
        const currentSocket = this.socket;
        this.socket = null;
        currentSocket?.close(1000, 'sdk.close');
    }
    async connectNextSocket() {
        const credential = await this.getCredential();
        if (this.closed) {
            throw new LiveRoomSdkError({
                code: 'SDK_CLOSED',
                message: 'The SDK has already been closed.'
            });
        }
        const generation = ++this.socketGeneration;
        const socket = this.runtime.createWebSocket(credential.url);
        this.socket = socket;
        await new Promise((resolve, reject) => {
            let resolved = false;
            let readyTimer = null;
            const clearReadyTimer = () => {
                if (readyTimer) {
                    this.runtime.clearTimeout(readyTimer);
                    readyTimer = null;
                }
            };
            const cleanup = () => {
                clearReadyTimer();
                socket.removeEventListener('open', handleOpen);
                socket.removeEventListener('message', handleMessage);
                socket.removeEventListener('close', handleClose);
                socket.removeEventListener('error', handleError);
                if (this.detachSocketListeners === cleanup) {
                    this.detachSocketListeners = null;
                }
                if (this.cancelOpen === fail) {
                    this.cancelOpen = null;
                }
            };
            this.detachSocketListeners?.();
            this.detachSocketListeners = cleanup;
            const fail = (error) => {
                if (resolved) {
                    return;
                }
                resolved = true;
                cleanup();
                reject(error);
            };
            this.cancelOpen = fail;
            const succeed = () => {
                if (resolved) {
                    return;
                }
                resolved = true;
                clearReadyTimer();
                this.reconnectAttempts = 0;
                resolve();
            };
            const handleOpen = () => {
                if (generation !== this.socketGeneration || this.closed) {
                    return;
                }
                socket.send(JSON.stringify({
                    type: 'room.auth',
                    ticket: credential.ticket,
                    protocol_version: '1.0'
                }));
            };
            const handleMessage = (event) => {
                if (generation !== this.socketGeneration || this.closed) {
                    return;
                }
                let payload;
                try {
                    payload = JSON.parse(String(event.data ?? '{}'));
                }
                catch (error) {
                    this.logger?.warn?.('Discarded invalid websocket payload', {
                        error: error instanceof Error ? error.message : String(error)
                    });
                    return;
                }
                switch (payload.type) {
                    case 'room.ready': {
                        const heartbeatInterval = typeof payload.heartbeat_interval === 'number' ? payload.heartbeat_interval : 15;
                        const room = (payload.room ?? {});
                        const online = typeof room.online === 'number' ? room.online : null;
                        this.callbacks.onReady(online);
                        this.startHeartbeat(heartbeatInterval, generation);
                        succeed();
                        return;
                    }
                    case 'room.online.changed':
                        this.callbacks.onOnlineChanged(typeof payload.online === 'number' ? payload.online : null);
                        return;
                    case 'room.status.changed':
                        if (typeof payload.status === 'string') {
                            this.room.status = payload.status;
                            this.callbacks.onRoomStatusChanged(payload.status);
                        }
                        return;
                    case 'room.kicked':
                        {
                            const error = new LiveRoomSdkError({
                                code: 'WEBSOCKET_AUTH_FAILED',
                                message: 'The room websocket session was revoked.'
                            });
                            this.closed = true;
                            this.clearReconnectTimer();
                            this.stopHeartbeat();
                            if (this.socket === socket) {
                                this.socket = null;
                            }
                            this.callbacks.onError(error);
                            if (!resolved) {
                                fail(error);
                            }
                            else {
                                cleanup();
                            }
                        }
                        socket.close(4001, 'kicked');
                        return;
                    case 'error':
                        fail(new LiveRoomSdkError({
                            code: 'WEBSOCKET_AUTH_FAILED',
                            message: typeof payload.message === 'string' ? payload.message : 'Room websocket failed.'
                        }));
                        socket.close(4000, 'error');
                        return;
                    default:
                        return;
                }
            };
            const handleError = () => {
                if (resolved) {
                    return;
                }
                fail(new LiveRoomSdkError({
                    code: 'WEBSOCKET_AUTH_FAILED',
                    message: 'Failed to establish the room websocket.',
                    retryable: true
                }));
                socket.close(4000, 'error');
            };
            const handleClose = (event) => {
                if (generation !== this.socketGeneration) {
                    return;
                }
                cleanup();
                this.stopHeartbeat();
                this.socket = null;
                this.connectPromise = null;
                if (!resolved) {
                    fail(new LiveRoomSdkError({
                        code: 'WEBSOCKET_AUTH_FAILED',
                        message: `Room websocket closed before ready (${event.code ?? 1006}).`,
                        retryable: true
                    }));
                    return;
                }
                const roomEnded = ['STOPPED', 'ENDED'].includes((this.room.status ?? '').toUpperCase());
                if (!this.closed && !roomEnded) {
                    this.callbacks.onReconnecting();
                    this.scheduleReconnect();
                }
            };
            socket.addEventListener('open', handleOpen);
            socket.addEventListener('message', handleMessage);
            socket.addEventListener('close', handleClose);
            socket.addEventListener('error', handleError);
            readyTimer = this.runtime.setTimeout(() => {
                fail(new LiveRoomSdkError({
                    code: 'WEBSOCKET_AUTH_FAILED',
                    message: 'Room websocket did not become ready in time.',
                    retryable: true
                }));
                socket.close(4000, 'ready_timeout');
            }, READY_TIMEOUT_MS);
        }).catch((error) => {
            this.connectPromise = null;
            if (!this.closed) {
                this.callbacks.onReconnecting();
                this.scheduleReconnect();
            }
            throw error;
        });
        this.connectPromise = null;
    }
    startHeartbeat(intervalSeconds, generation) {
        this.stopHeartbeat();
        this.heartbeatTimer = this.runtime.setInterval(() => {
            if (generation !== this.socketGeneration || this.closed || !this.socket) {
                return;
            }
            this.socket.send(JSON.stringify({ type: 'room.heartbeat' }));
        }, Math.max(intervalSeconds, 1) * 1000);
    }
    stopHeartbeat() {
        if (this.heartbeatTimer) {
            this.runtime.clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
    }
    scheduleReconnect() {
        this.clearReconnectTimer();
        const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 15000);
        this.reconnectAttempts += 1;
        this.reconnectTimer = this.runtime.setTimeout(() => {
            this.reconnectTimer = null;
            if (this.closed) {
                return;
            }
            void this.open().catch((error) => {
                this.callbacks.onError(error);
            });
        }, delay);
    }
    clearReconnectTimer() {
        if (this.reconnectTimer) {
            this.runtime.clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }
}
//# sourceMappingURL=websocket.js.map