import { describe, expect, test } from "vitest";
import type { MessageRecord } from "../types";
import { formatHistory } from "./index";

const newestFirst: MessageRecord[] = [
  { id: 2, discordId: null, channelId: "c1", direction: "outbound", authorName: "Advisor", agentId: "a1", content: "hi laci", createdAt: "2026-07-12T10:00:01.000Z" },
  { id: 1, discordId: null, channelId: "c1", direction: "inbound", authorName: "laci", agentId: null, content: "hello", createdAt: "2026-07-12T10:00:00.000Z" },
];

describe("formatHistory", () => {
  test("renders oldest-first '[iso] author: content' lines", () => {
    expect(formatHistory(newestFirst)).toBe(
      "[2026-07-12T10:00:00.000Z] laci: hello\n[2026-07-12T10:00:01.000Z] Advisor: hi laci",
    );
  });

  test("empty history yields a placeholder", () => {
    expect(formatHistory([])).toBe("(no messages logged yet)");
  });
});
