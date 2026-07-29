export class TypedEventEmitter<TEventMap extends object> {
  private readonly handlers = new Map<keyof TEventMap, Set<(payload: unknown) => void>>();

  on<TKey extends keyof TEventMap>(event: TKey, handler: (payload: TEventMap[TKey]) => void): () => void {
    const existing = this.handlers.get(event) ?? new Set<(payload: unknown) => void>();
    existing.add(handler as (payload: unknown) => void);
    this.handlers.set(event, existing);

    return () => {
      const current = this.handlers.get(event);
      current?.delete(handler as (payload: unknown) => void);
      if (current && current.size === 0) {
        this.handlers.delete(event);
      }
    };
  }

  emit<TKey extends keyof TEventMap>(event: TKey, payload: TEventMap[TKey]): void {
    const current = this.handlers.get(event);
    if (!current) {
      return;
    }

    for (const handler of current) {
      handler(payload);
    }
  }
}
