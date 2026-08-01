import { HttpClient } from './HttpClient.js';
import { LiveRoomState } from './LiveRoom.js';
import { LiveRoomUserState } from './User.js';
import { LiveRoomSdkError } from './errors.js';
import { connectGoEasy } from './internal/goeasy.js';
import { createDefaultRuntime } from './internal/runtime.js';
import { ViewerWebSocketTransport } from './internal/websocket.js';
function normalizeMediaSources(sources) {
    return (sources ?? []).map((source) => ({
        protocol: source.protocol,
        url: source.url,
        expiresAt: source.expires_at
    }));
}
function normalizeRoomSnapshot(bootstrap) {
    const playback = bootstrap.room.playback;
    return {
        snapshot: {
            id: bootstrap.room.id,
            title: bootstrap.room.title,
            status: bootstrap.room.status,
            likeCount: bootstrap.room.like_count,
            muted: bootstrap.room.muted,
            notice: bootstrap.room.notice,
            features: bootstrap.room.features,
            playback: playback
                ? {
                    mode: playback.mode,
                    sources: normalizeMediaSources(playback.sources)
                }
                : undefined
        },
        sequence: bootstrap.room.current_sequence ?? bootstrap.room.sequence ?? null
    };
}
function isExpired(expiresAt, now) {
    return typeof expiresAt === 'number' && expiresAt <= now + 5_000;
}
function parseExpiry(value) {
    if (!value) {
        return undefined;
    }
    const millis = Date.parse(value);
    return Number.isNaN(millis) ? undefined : millis;
}
function isTerminalRoomStatus(status) {
    return ['STOPPED', 'ENDED'].includes((status ?? '').toUpperCase());
}
export class LiveRoomSdkImpl {
    options;
    user = new LiveRoomUserState();
    room;
    logger;
    runtime;
    httpClient;
    authClient;
    requestAbortController = new AbortController();
    session = null;
    goeasyConnection = null;
    websocketTransport = null;
    closed = false;
    sessionCreateFlight = null;
    connectFlight = null;
    refreshFlight = null;
    sessionRefreshFlight = null;
    closeFlight = null;
    constructor(options, runtimeOptions = {}) {
        this.options = options;
        this.logger = options.logger;
        this.runtime = runtimeOptions.runtime ?? createDefaultRuntime(options.fetch, this.logger);
        this.room = new LiveRoomState({
            connect: () => this.connect(),
            refresh: () => this.refresh(),
            close: () => this.close(),
            refreshInfo: () => this.refreshInfo(),
            refreshMedia: () => this.refreshMedia(),
            loadPreviousMessages: (cursor) => this.loadPreviousMessages(cursor),
            sendComment: (text) => this.sendComment(text),
            sendLike: (count) => this.sendLike(count),
            deleteComment: (messageId, reason) => this.deleteComment(messageId, reason),
            muteUser: (userId) => this.muteUser(userId),
            unmuteUser: (userId) => this.unmuteUser(userId),
            setRoomMute: (enabled) => this.setRoomMute(enabled)
        });
        this.room.on('room.status.changed', ({ room }) => {
            if (['STOPPED', 'ENDED'].includes((room.status ?? '').toUpperCase())) {
                // GoEasy 和 WebSocket 都会进入同一状态事件，统一关闭实时资源。
                void this.disposeRealtime();
            }
        });
        this.authClient = new HttpClient({
            baseUrl: options.apiBaseUrl,
            fetch: this.runtime.fetch,
            signal: this.requestAbortController.signal
        });
        this.httpClient = new HttpClient({
            baseUrl: options.apiBaseUrl,
            fetch: this.runtime.fetch,
            signal: this.requestAbortController.signal,
            onUnauthorized: async () => {
                await this.refreshSession(true);
                return this.session?.accessToken ?? null;
            }
        });
    }
    async connect() {
        if (this.connectFlight) {
            return this.connectFlight;
        }
        if (this.refreshFlight) {
            return this.refreshFlight;
        }
        this.assertOpen();
        this.connectFlight = this.connectInternal().finally(() => {
            this.connectFlight = null;
        });
        return this.connectFlight;
    }
    async refresh() {
        if (this.refreshFlight) {
            return this.refreshFlight;
        }
        if (this.connectFlight) {
            return this.connectFlight;
        }
        this.assertOpen();
        this.refreshFlight = this.refreshInternal().finally(() => {
            this.refreshFlight = null;
        });
        return this.refreshFlight;
    }
    async close() {
        if (this.closeFlight) {
            return this.closeFlight;
        }
        this.closeFlight = this.closeInternal().finally(() => {
            this.closeFlight = null;
        });
        return this.closeFlight;
    }
    async connectInternal() {
        try {
            this.room.setState('authenticating');
            await this.ensureSession();
            this.assertOpen();
            this.room.setState('bootstrapping');
            const bootstrap = await this.fetchBootstrap();
            this.assertOpen();
            this.applyBootstrap(bootstrap, true);
            if (isTerminalRoomStatus(this.room.info?.status)) {
                this.room.setState('ended');
                return;
            }
            this.room.setState('connecting');
            let realtimeError = null;
            try {
                realtimeError = await this.startRealtime();
            }
            catch (error) {
                realtimeError = error;
            }
            if (this.room.state === 'ended') {
                return;
            }
            this.assertOpen();
            this.room.setState('synchronizing');
            await this.loadInitialMessages();
            await this.catchUpMessages();
            this.assertOpen();
            this.room.drainBufferedEvents();
            if (isTerminalRoomStatus(this.room.info?.status)) {
                this.room.setState('ended');
                return;
            }
            if (realtimeError) {
                this.degradeRealtime(realtimeError);
                return;
            }
            this.room.setState('ready');
        }
        catch (error) {
            if (this.room.state === 'ended') {
                return;
            }
            if (this.closed) {
                this.assertOpen();
            }
            if (!this.closed) {
                // 同步失败后不能保留已连接的实时通道和心跳。
                await this.disposeRealtime();
                this.room.emitError(this.asError(error));
                this.room.setState('error');
            }
            throw error;
        }
    }
    async refreshInternal() {
        try {
            this.room.setState('reconnecting');
            await this.refreshSession(false);
            this.assertOpen();
            const bootstrap = await this.fetchBootstrap();
            this.assertOpen();
            this.applyBootstrap(bootstrap, false);
            if (isTerminalRoomStatus(this.room.info?.status)) {
                this.room.setState('ended');
                return;
            }
            let realtimeError = null;
            try {
                realtimeError = await this.restartRealtime();
            }
            catch (error) {
                realtimeError = error;
            }
            if (this.room.state === 'ended') {
                return;
            }
            await this.catchUpMessages();
            this.assertOpen();
            this.room.drainBufferedEvents();
            if (isTerminalRoomStatus(this.room.info?.status)) {
                this.room.setState('ended');
                return;
            }
            if (realtimeError) {
                this.degradeRealtime(realtimeError);
                return;
            }
            this.room.setState('ready');
        }
        catch (error) {
            if (this.room.state === 'ended') {
                return;
            }
            if (this.closed) {
                this.assertOpen();
            }
            if (!this.closed) {
                // 刷新失败时旧通道已被替换，必须同时释放新通道。
                await this.disposeRealtime();
                this.room.emitError(this.asError(error));
                this.room.setState('error');
            }
            throw error;
        }
    }
    async closeInternal() {
        if (this.closed) {
            return;
        }
        this.closed = true;
        // 页面销毁时停止未完成的 bootstrap、历史和命令请求。
        this.requestAbortController.abort();
        this.room.setState('closed');
        await this.disposeRealtime();
        if (this.session) {
            await this.httpClient
                .request({
                method: 'DELETE',
                path: '/sdk/v1/sessions/current',
                accessToken: this.session.accessToken,
                signal: null,
                retryOnUnauthorized: false
            })
                .catch(() => undefined);
        }
        this.session = null;
        this.user.clear();
    }
    async ensureSession() {
        if (this.session && !isExpired(this.session.expiresAt, this.runtime.now())) {
            return this.session;
        }
        if (!this.sessionCreateFlight) {
            // 一次性 viewer ticket 只能交换一次，所有首个请求必须复用同一个会话创建。
            this.sessionCreateFlight = this.createSession()
                .then((next) => {
                this.session = next;
                return next;
            })
                .finally(() => {
                this.sessionCreateFlight = null;
            });
        }
        return this.sessionCreateFlight;
    }
    async refreshSession(force) {
        if (this.sessionCreateFlight) {
            return this.sessionCreateFlight;
        }
        const current = this.session;
        if (!current) {
            return this.ensureSession();
        }
        if (!force && !isExpired(current.expiresAt, this.runtime.now())) {
            return current;
        }
        if (this.options.auth.type === 'ticket') {
            throw new LiveRoomSdkError({
                code: 'SESSION_EXPIRED',
                message: 'Ticket sessions cannot be refreshed after expiry.'
            });
        }
        if (!this.sessionRefreshFlight) {
            // 并发 401 只换取一个后台 Operator 会话，后续请求复用同一令牌。
            this.sessionRefreshFlight = this.createSession()
                .then((next) => {
                this.session = next;
                return next;
            })
                .finally(() => {
                this.sessionRefreshFlight = null;
            });
        }
        return this.sessionRefreshFlight;
    }
    async createSession() {
        let sessionResponse;
        if (this.options.auth.type === 'ticket') {
            const response = await this.authClient.request({
                method: 'POST',
                path: '/sdk/v1/sessions/exchange',
                body: { ticket: this.options.auth.ticket },
                retryOnUnauthorized: false
            });
            sessionResponse = response.data;
        }
        else {
            if (!this.options.roomId) {
                throw new LiveRoomSdkError({
                    code: 'INVALID_RESPONSE',
                    message: 'roomId is required for platform-operator auth.'
                });
            }
            const platformToken = await this.options.auth.getAccessToken();
            const response = await this.authClient.request({
                method: 'POST',
                path: `/sdk/v1/rooms/${encodeURIComponent(this.options.roomId)}/operator-session`,
                accessToken: platformToken,
                retryOnUnauthorized: false
            });
            sessionResponse = response.data;
        }
        return {
            accessToken: sessionResponse.access_token,
            expiresAt: parseExpiry(sessionResponse.expires_at)
        };
    }
    async fetchBootstrap() {
        const session = await this.ensureSession();
        const response = await this.httpClient.request({
            method: 'GET',
            path: '/sdk/v1/rooms/current/bootstrap',
            accessToken: session.accessToken
        });
        return response.data;
    }
    applyBootstrap(bootstrap, resetMessages) {
        this.user.hydrate({
            id: bootstrap.user.id,
            externalId: bootstrap.user.external_id,
            nickname: bootstrap.user.nickname,
            avatarUrl: bootstrap.user.avatar_url,
            role: bootstrap.user.role,
            capabilities: bootstrap.user.capabilities ?? []
        });
        const { snapshot, sequence } = normalizeRoomSnapshot(bootstrap);
        if (this.options.roomId && snapshot.id && this.options.auth.type === 'ticket' && this.options.roomId !== snapshot.id) {
            throw new LiveRoomSdkError({
                code: 'ROOM_NOT_ACCESSIBLE',
                message: `Expected room ${this.options.roomId} but bootstrap returned ${snapshot.id}.`
            });
        }
        if (resetMessages) {
            this.room.replaceSnapshot(snapshot, sequence);
        }
        else {
            this.room.updateSnapshot(snapshot);
        }
        this.room.beginSync(sequence);
    }
    async fetchRealtimeCredential() {
        const session = await this.ensureSession();
        const response = await this.httpClient.request({
            method: 'POST',
            path: '/sdk/v1/rooms/current/realtime-credential',
            accessToken: session.accessToken
        });
        return response.data;
    }
    async startRealtime() {
        const credential = await this.fetchRealtimeCredential();
        this.assertOpen();
        return this.attachRealtime(credential);
    }
    async restartRealtime() {
        await this.disposeRealtime();
        this.assertOpen();
        const credential = await this.fetchRealtimeCredential();
        this.assertOpen();
        return this.attachRealtime(credential);
    }
    degradeRealtime(error) {
        if (this.room.state === 'ended') {
            return;
        }
        const normalized = error instanceof Error
            ? error
            : new LiveRoomSdkError({
                code: 'NETWORK_ERROR',
                message: 'Realtime connection failed.'
            });
        this.room.emitError(normalized);
        this.room.setState('degraded');
    }
    async attachRealtime(credential) {
        let error = null;
        try {
            this.goeasyConnection = await connectGoEasy(this.runtime, credential.goeasy, (event) => {
                this.room.applyRealtimeEvent(event);
            }, this.logger);
        }
        catch (connectionError) {
            error = this.asError(connectionError);
        }
        if (this.room.state === 'ended') {
            await this.disposeRealtime();
            return null;
        }
        if (this.closed) {
            await this.disposeRealtime();
            this.assertOpen();
        }
        if (this.user.role === 'viewer' && credential.websocket?.ticket) {
            const roomSnapshot = this.room.info;
            if (!roomSnapshot) {
                throw new LiveRoomSdkError({
                    code: 'INVALID_RESPONSE',
                    message: 'Room bootstrap must complete before opening websocket.'
                });
            }
            try {
                this.websocketTransport = new ViewerWebSocketTransport(this.runtime, async () => {
                    const next = await this.fetchRealtimeCredential();
                    if (!next.websocket) {
                        throw new LiveRoomSdkError({
                            code: 'WEBSOCKET_AUTH_FAILED',
                            message: 'Viewer websocket credentials are not available.'
                        });
                    }
                    return {
                        url: next.websocket.url,
                        ticket: next.websocket.ticket
                    };
                }, {
                    onReady: (online) => this.handleWebSocketReady(online),
                    onOnlineChanged: (online) => this.room.setOnline(online),
                    onRoomStatusChanged: (status) => this.room.setRoomStatus(status),
                    onError: (websocketError) => this.room.emitError(websocketError),
                    onReconnecting: () => this.room.setState('reconnecting')
                }, roomSnapshot, this.logger);
                await this.websocketTransport.open();
            }
            catch (connectionError) {
                error ??= this.asError(connectionError);
            }
        }
        if (this.closed) {
            await this.disposeRealtime();
            this.assertOpen();
        }
        return error;
    }
    async disposeRealtime() {
        const websocket = this.websocketTransport;
        this.websocketTransport = null;
        await websocket?.close();
        const goeasy = this.goeasyConnection;
        this.goeasyConnection = null;
        await goeasy?.close();
    }
    async catchUpMessages() {
        let sequence = this.room.getLastSequence();
        if (sequence === null) {
            return;
        }
        const session = await this.ensureSession();
        while (true) {
            const response = await this.httpClient.request({
                method: 'GET',
                path: '/sdk/v1/rooms/current/messages',
                query: {
                    after_sequence: sequence
                },
                accessToken: session.accessToken
            });
            for (const event of response.data.events ?? []) {
                this.room.applyRealtimeEvent(event);
            }
            this.assertOpen();
            const nextSequence = response.data.next_sequence;
            if (!response.data.has_more || typeof nextSequence !== 'number' || nextSequence <= sequence) {
                return;
            }
            sequence = nextSequence;
        }
    }
    async loadInitialMessages() {
        await this.loadPreviousMessages();
    }
    async refreshInfo() {
        const bootstrap = await this.fetchBootstrap();
        const { snapshot } = normalizeRoomSnapshot(bootstrap);
        this.room.updateSnapshot(snapshot);
        return snapshot;
    }
    async refreshMedia() {
        const session = await this.ensureSession();
        const response = await this.httpClient.request({
            method: 'POST',
            path: '/sdk/v1/rooms/current/refresh-media',
            accessToken: session.accessToken
        });
        const current = this.room.info;
        const sources = normalizeMediaSources(response.data.playback?.sources ?? response.data.sources);
        if (current) {
            current.playback = {
                mode: response.data.playback?.mode ?? current.playback?.mode,
                sources
            };
        }
        return sources;
    }
    async loadPreviousMessages(cursor) {
        const session = await this.ensureSession();
        const response = await this.httpClient.request({
            method: 'GET',
            path: '/sdk/v1/rooms/current/messages',
            query: {
                before_cursor: cursor
            },
            accessToken: session.accessToken
        });
        return {
            messages: this.room.hydrateHistory(response.data.messages ?? []),
            nextCursor: response.data.next_cursor,
            hasMore: Boolean(response.data.has_more)
        };
    }
    async sendComment(text) {
        this.requireCapability('message:send');
        const session = await this.ensureSession();
        const clientRequestId = this.runtime.createId('cr');
        const pending = {
            messageId: this.runtime.createId('pending'),
            eventId: undefined,
            clientRequestId,
            sequence: undefined,
            author: {
                id: this.user.id,
                nickname: this.user.nickname,
                avatarUrl: this.user.avatarUrl
            },
            content: {
                type: 'text',
                text
            },
            state: 'pending',
            createdAt: new Date(this.runtime.now()).toISOString()
        };
        this.room.trackPending(pending);
        try {
            await this.httpClient.request({
                method: 'POST',
                path: '/sdk/v1/rooms/current/commands/comments',
                accessToken: session.accessToken,
                body: {
                    client_request_id: clientRequestId,
                    content: {
                        type: 'text',
                        text
                    }
                }
            });
            pending.state = 'accepted';
            // GoEasy 回声丢失时，仍可从持久化事件按 sequence 补齐。
            void this.catchUpMessages().catch((catchUpError) => {
                this.room.emitError(this.asError(catchUpError));
            });
            return pending;
        }
        catch (error) {
            pending.state = 'rejected';
            throw error;
        }
    }
    async sendLike(count = 1) {
        this.requireCapability('message:send');
        const session = await this.ensureSession();
        const clientRequestId = this.runtime.createId('cr');
        const response = await this.httpClient.request({
            method: 'POST',
            path: '/sdk/v1/rooms/current/commands/likes',
            accessToken: session.accessToken,
            body: {
                client_request_id: clientRequestId,
                count
            }
        });
        // REST 成功与 GoEasy 回声共享 event_id，reducer 会自动去重。
        this.room.applyRealtimeEvent({
            event_id: response.data.event_id,
            event_type: 'engagement.like.delta.v1',
            room_id: this.room.id,
            sequence: response.data.sequence,
            data: {
                count: response.data.count,
                total: response.data.total,
                user_id: this.user.id,
                client_request_id: clientRequestId
            }
        });
    }
    async deleteComment(messageId, reason) {
        this.requireCapability('message:delete');
        const session = await this.ensureSession();
        await this.httpClient.request({
            method: 'POST',
            path: '/sdk/v1/rooms/current/commands/delete-comment',
            accessToken: session.accessToken,
            body: {
                message_id: messageId,
                reason
            }
        });
    }
    async muteUser(userId) {
        this.requireCapability('user:mute');
        const session = await this.ensureSession();
        await this.httpClient.request({
            method: 'POST',
            path: '/sdk/v1/rooms/current/commands/mute-user',
            accessToken: session.accessToken,
            body: { user_id: userId }
        });
    }
    async unmuteUser(userId) {
        this.requireCapability('user:mute');
        const session = await this.ensureSession();
        await this.httpClient.request({
            method: 'POST',
            path: '/sdk/v1/rooms/current/commands/unmute-user',
            accessToken: session.accessToken,
            body: {
                user_id: userId
            }
        });
    }
    async setRoomMute(enabled) {
        this.requireCapability('room:mute');
        const session = await this.ensureSession();
        await this.httpClient.request({
            method: 'POST',
            path: '/sdk/v1/rooms/current/commands/room-mute',
            accessToken: session.accessToken,
            body: { enabled }
        });
    }
    requireCapability(capability) {
        if (this.user.capabilities.includes(capability)) {
            return;
        }
        throw new LiveRoomSdkError({
            code: 'CAPABILITY_DENIED',
            message: `Missing required capability: ${capability}`
        });
    }
    assertOpen() {
        if (this.closed) {
            throw new LiveRoomSdkError({
                code: 'SDK_CLOSED',
                message: 'The SDK has already been closed.'
            });
        }
    }
    handleWebSocketReady(online) {
        this.room.setOnline(online);
        if (this.room.state !== 'reconnecting') {
            return;
        }
        if (!this.goeasyConnection) {
            this.room.setState('degraded');
            return;
        }
        void this.catchUpMessages()
            .then(() => {
            this.room.drainBufferedEvents();
            if (this.room.state === 'reconnecting') {
                this.room.setState('ready');
            }
        })
            .catch((error) => this.degradeRealtime(error));
    }
    asError(error) {
        return error instanceof Error
            ? error
            : new LiveRoomSdkError({
                code: 'NETWORK_ERROR',
                message: 'Realtime connection failed.',
                cause: error
            });
    }
}
export function createLiveRoomSdk(options) {
    return new LiveRoomSdkImpl(options);
}
//# sourceMappingURL=LiveRoomSdk.js.map