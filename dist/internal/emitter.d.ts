export declare class TypedEventEmitter<TEventMap extends object> {
    private readonly handlers;
    on<TKey extends keyof TEventMap>(event: TKey, handler: (payload: TEventMap[TKey]) => void): () => void;
    emit<TKey extends keyof TEventMap>(event: TKey, payload: TEventMap[TKey]): void;
}
//# sourceMappingURL=emitter.d.ts.map