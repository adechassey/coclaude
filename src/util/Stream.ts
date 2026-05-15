// A fire-and-forget signal: no stored value, no replay on subscribe.

export class Stream<T> {
  private readonly listeners = new Set<(value: T) => void>();

  emit(value: T): void {
    for (const l of this.listeners) l(value);
  }

  on(listener: (value: T) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
