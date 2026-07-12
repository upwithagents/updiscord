import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { DebounceBuffer, type BufferedMessage } from "./debounce";

function msg(channelId: string, content: string): BufferedMessage {
  return { channelId, channelName: "general", author: "laci", content, messageId: `m-${content}` };
}

describe("DebounceBuffer", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test("delivers a single message after the window", () => {
    const delivered: BufferedMessage[][] = [];
    const buf = new DebounceBuffer((_ch, msgs) => delivered.push(msgs));
    buf.push(msg("c1", "hello"));
    vi.advanceTimersByTime(4999);
    expect(delivered).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(delivered).toHaveLength(1);
    expect(delivered[0].map((m) => m.content)).toEqual(["hello"]);
  });

  test("collapses a burst into one delivery", () => {
    const delivered: BufferedMessage[][] = [];
    const buf = new DebounceBuffer((_ch, msgs) => delivered.push(msgs));
    buf.push(msg("c1", "one"));
    vi.advanceTimersByTime(3000);
    buf.push(msg("c1", "two"));
    vi.advanceTimersByTime(4999);
    expect(delivered).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(delivered).toHaveLength(1);
    expect(delivered[0].map((m) => m.content)).toEqual(["one", "two"]);
  });

  test("max wait caps how long a busy channel can defer delivery", () => {
    const delivered: BufferedMessage[][] = [];
    const buf = new DebounceBuffer((_ch, msgs) => delivered.push(msgs));
    buf.push(msg("c1", "a")); // t=0
    vi.advanceTimersByTime(4000);
    buf.push(msg("c1", "b")); // t=4000, elapsed 4000 → wait min(5000, 6000) = 5000
    vi.advanceTimersByTime(4000);
    buf.push(msg("c1", "c")); // t=8000, elapsed 8000 → wait min(5000, 2000) = 2000
    vi.advanceTimersByTime(2000); // t=10000
    expect(delivered).toHaveLength(1);
    expect(delivered[0].map((m) => m.content)).toEqual(["a", "b", "c"]);
  });

  test("channels are debounced independently", () => {
    const delivered: Array<[string, string[]]> = [];
    const buf = new DebounceBuffer((ch, msgs) => delivered.push([ch, msgs.map((m) => m.content)]));
    buf.push(msg("c1", "one"));
    buf.push(msg("c2", "two"));
    vi.advanceTimersByTime(5000);
    expect(delivered).toEqual([
      ["c1", ["one"]],
      ["c2", ["two"]],
    ]);
  });
});
