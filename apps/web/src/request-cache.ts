// Small, disposable cache for suggestion menus. Concurrent consumers share a
// request; the last consumer leaving aborts the underlying network operation.
export class RequestCache<T> {
  private values = new Map<string, { value: T; expires: number }>();
  private pending = new Map<
    string,
    {
      promise: Promise<T>;
      controller: AbortController;
      users: number;
    }
  >();
  constructor(
    private readonly maxEntries = 32,
    private readonly maxAge = 60_000,
  ) {}
  clear(): void {
    this.values.clear();
    for (const request of this.pending.values()) request.controller.abort();
    this.pending.clear();
  }
  get(
    key: string,
    fetchValue: (signal: AbortSignal) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const aborted = () => new DOMException("Aborted", "AbortError");
    if (signal?.aborted) return Promise.reject(aborted());
    const cached = this.values.get(key);
    if (cached && cached.expires > Date.now())
      return Promise.resolve(cached.value);
    let request = this.pending.get(key);
    if (!request) {
      const controller = new AbortController();
      const active: {
        controller: AbortController;
        users: number;
        promise: Promise<T>;
      } = {
        controller,
        users: 0,
        promise: Promise.resolve(undefined as T),
      };
      active.promise = fetchValue(controller.signal)
        .then((value) => {
          if (controller.signal.aborted) throw aborted();
          if (this.pending.get(key) === active) {
            this.values.delete(key);
            this.values.set(key, { value, expires: Date.now() + this.maxAge });
            while (this.values.size > this.maxEntries)
              this.values.delete(this.values.keys().next().value!);
          }
          return value;
        })
        .finally(() => {
          if (this.pending.get(key) === active) this.pending.delete(key);
        });
      this.pending.set(key, active);
      request = active;
    }
    const active = request;
    active.users++;
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = () => {
        if (done) return false;
        done = true;
        active.users--;
        signal?.removeEventListener("abort", abort);
        return true;
      };
      const abort = () => {
        if (!finish()) return;
        reject(aborted());
        if (!active.users) {
          active.controller.abort();
          if (this.pending.get(key) === active) this.pending.delete(key);
        }
      };
      signal?.addEventListener("abort", abort, { once: true });
      active.promise.then(
        (value) => {
          if (finish()) resolve(value);
        },
        (reason: unknown) => {
          if (finish())
            reject(
              reason instanceof Error ? reason : new Error(String(reason)),
            );
        },
      );
    });
  }
}
