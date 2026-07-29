export class LiveRoomSdkError extends Error {
    code;
    requestId;
    retryable;
    status;
    constructor(init) {
        super(init.message, init.cause ? { cause: init.cause } : undefined);
        this.name = 'LiveRoomSdkError';
        this.code = init.code;
        this.requestId = init.requestId;
        this.retryable = init.retryable ?? false;
        this.status = init.status;
    }
}
export function isLiveRoomSdkError(error) {
    return error instanceof LiveRoomSdkError;
}
//# sourceMappingURL=errors.js.map