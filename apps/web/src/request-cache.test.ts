import { describe, expect, it, vi } from "vitest";
import { RequestCache } from "./request-cache.js";

describe("suggestion request cache", () => {
  it("shares requests, retains other consumers and aborts when everyone leaves", async () => {
    const cache = new RequestCache<string>();
    let finish!: (value: string) => void;
    let networkSignal!: AbortSignal;
    const fetchValue = vi.fn((signal: AbortSignal) => {
      networkSignal = signal;
      return new Promise<string>((resolve) => {
        finish = resolve;
      });
    });
    const a = new AbortController();
    const b = new AbortController();
    const first = cache.get("key", fetchValue, a.signal);
    const second = cache.get("key", fetchValue, b.signal);
    a.abort();
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    expect(networkSignal.aborted).toBe(false);
    finish("result");
    expect(await second).toBe("result");
    expect(await cache.get("key", fetchValue)).toBe("result");
    expect(fetchValue).toHaveBeenCalledTimes(1);
    const pending = cache.get("another", fetchValue, b.signal);
    b.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(networkSignal.aborted).toBe(true);
    finish("stale");
    cache.clear();
  });
});
