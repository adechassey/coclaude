// A latest-value-with-replay signal: subscribers see the current value
// synchronously on `on()`, then every subsequent `set()`. Dedupes by reference
// equality (Object.is) — callers passing fresh arrays/objects each time should
// expect every update to fire.

export class Topic<T> {
  private current: T;
  private readonly listeners = new Set<(value: T) => void>();

  constructor(initial: T) {
    this.current = initial;
  }

  get value(): T {
    return this.current;
  }

  set(value: T): void {
    if (Object.is(this.current, value)) return;
    this.current = value;
    for (const l of this.listeners) l(value);
  }

  on(listener: (value: T) => void): () => void {
    listener(this.current);
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
