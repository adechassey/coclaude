import { describe, expect, it, vi } from "vitest";
import { Topic } from "../../src/util/Topic.js";

describe("Topic", () => {
  it("returns the initial value", () => {
    const t = new Topic(42);
    expect(t.value).toBe(42);
  });

  it("replays the current value on subscribe", () => {
    const t = new Topic("hi");
    const fn = vi.fn();
    t.on(fn);
    expect(fn).toHaveBeenCalledWith("hi");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("notifies subscribers on set", () => {
    const t = new Topic(0);
    const fn = vi.fn();
    t.on(fn);
    fn.mockClear();
    t.set(1);
    expect(fn).toHaveBeenCalledWith(1);
  });

  it("dedupes set with Object.is equality", () => {
    const t = new Topic(7);
    const fn = vi.fn();
    t.on(fn);
    fn.mockClear();
    t.set(7);
    expect(fn).not.toHaveBeenCalled();
  });

  it("does not dedupe equal arrays (reference compare)", () => {
    const t = new Topic<number[]>([1, 2]);
    const fn = vi.fn();
    t.on(fn);
    fn.mockClear();
    t.set([1, 2]);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("stops notifying after unsubscribe", () => {
    const t = new Topic(0);
    const fn = vi.fn();
    const off = t.on(fn);
    fn.mockClear();
    off();
    t.set(1);
    expect(fn).not.toHaveBeenCalled();
  });

  it("late subscriber sees latest value", () => {
    const t = new Topic("a");
    t.set("b");
    t.set("c");
    const fn = vi.fn();
    t.on(fn);
    expect(fn).toHaveBeenCalledWith("c");
  });
});
