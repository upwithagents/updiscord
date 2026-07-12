import { describe, expect, test } from "vitest";
import type { Client, Message } from "discord.js";
import { isEcho } from "./discord";

function fakeClient(botId: string): Client {
  return { user: { id: botId } } as unknown as Client;
}

function fakeMessage(authorId: string, webhookId: string | null): Message {
  return { author: { id: authorId }, webhookId } as unknown as Message;
}

describe("isEcho", () => {
  test("true for the bot's own messages", () => {
    expect(isEcho(fakeClient("bot1"), fakeMessage("bot1", null))).toBe(true);
  });

  test("true for webhook (persona) messages", () => {
    expect(isEcho(fakeClient("bot1"), fakeMessage("user1", "wh1"))).toBe(true);
  });

  test("false for ordinary user messages", () => {
    expect(isEcho(fakeClient("bot1"), fakeMessage("user1", null))).toBe(false);
  });
});
