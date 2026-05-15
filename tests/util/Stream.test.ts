import { describe, expect, it, vi } from "vitest";
import { Stream } from "../../src/util/Stream.js";

describe("Stream", () => {
  it("does not replay on subscribe", () => {
    const s = new Stream<string>();
    s.emit("missed");
    const fn = vi.fn();
    s.on(fn);
    expect(fn).not.toHaveBeenCalled();
  });

  it("notifies all subscribers on emit", () => {
    const s = new Stream<number>();
    const a = vi.fn();
    const b = vi.fn();
    s.on(a);
    s.on(b);
    s.emit(99);
    expect(a).toHaveBeenCalledWith(99);
    expect(b).toHaveBeenCalledWith(99);
  });

  it("stops notifying after unsubscribe", () => {
    const s = new Stream<number>();
    const fn = vi.fn();
    const off = s.on(fn);
    off();
    s.emit(1);
    expect(fn).not.toHaveBeenCalled();
  });

  it("does not dedupe consecutive equal emits", () => {
    const s = new Stream<number>();
    const fn = vi.fn();
    s.on(fn);
    s.emit(1);
    s.emit(1);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
