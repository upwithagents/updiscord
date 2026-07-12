import { describe, expect, test } from "vitest";
import { splitMessage } from "./split";

describe("splitMessage", () => {
  test("returns short content as a single chunk", () => {
    expect(splitMessage("hello")).toEqual(["hello"]);
  });

  test("prefers paragraph breaks", () => {
    const a = "a".repeat(1000);
    const b = "b".repeat(1500);
    const chunks = splitMessage(`${a}\n\n${b}`);
    expect(chunks).toEqual([a, b]);
  });

  test("closes and reopens code fences across chunks", () => {
    const codeLines = Array.from({ length: 40 }, () => "x".repeat(80)).join("\n");
    const content = "```js\n" + codeLines + "\n```";
    const chunks = splitMessage(content);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].endsWith("```")).toBe(true);
    expect(chunks[1].startsWith("```js")).toBe(true);
    // Every chunk fits Discord's hard limit
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(2000);
  });

  test("force-splits content with no whitespace", () => {
    const chunks = splitMessage("x".repeat(4000));
    expect(chunks).toEqual(["x".repeat(1900), "x".repeat(1900), "x".repeat(200)]);
  });
});
