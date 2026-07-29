export class TypedEventEmitter {
    handlers = new Map();
    on(event, handler) {
        const existing = this.handlers.get(event) ?? new Set();
        existing.add(handler);
        this.handlers.set(event, existing);
        return () => {
            const current = this.handlers.get(event);
            current?.delete(handler);
            if (current && current.size === 0) {
                this.handlers.delete(event);
            }
        };
    }
    emit(event, payload) {
        const current = this.handlers.get(event);
        if (!current) {
            return;
        }
        for (const handler of current) {
            handler(payload);
        }
    }
}
//# sourceMappingURL=emitter.js.map