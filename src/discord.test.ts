import { ChannelType } from "discord.js";
import { describe, expect, test, vi } from "vitest";
import type { Client, Message } from "discord.js";
import { ensureWebhook, isEcho } from "./discord";
import type { AgentRecord, HubStore } from "./types";

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

function makeAgent(overrides: Partial<AgentRecord> = {}): AgentRecord {
  return {
    id: "agent1",
    name: "Jake",
    kind: "concierge",
    channelId: "general",
    webhookId: null,
    webhookToken: null,
    tmuxSession: null,
    adapterPort: 4700,
    status: "ready",
    listensGuildWide: true,
    ...overrides,
  };
}

function fakeStore(): HubStore {
  return { updateAgent: vi.fn(async () => {}) } as unknown as HubStore;
}

function fakeClientWithChannel(fetchWebhooks: () => Promise<{ name: string; token: string | null }[]>, createWebhook: () => Promise<{ id: string; token: string }>) {
  const channel = {
    type: ChannelType.GuildText,
    fetchWebhooks,
    createWebhook,
  };
  return { channels: { fetch: vi.fn(async () => channel) } } as unknown as Client;
}

describe("ensureWebhook", () => {
  test("uses the store-persisted webhook for the agent's own channel without hitting Discord", async () => {
    const agent = makeAgent({ channelId: "general", webhookId: "wh-general", webhookToken: "tok-general" });
    const client = fakeClientWithChannel(
      () => { throw new Error("should not be called"); },
      () => { throw new Error("should not be called"); },
    );
    const result = await ensureWebhook(client, fakeStore(), "hub", agent, "general");
    expect(result).toEqual({ id: "wh-general", token: "tok-general" });
  });

  test("creates a separate webhook for a different channel and does not persist it as the agent's primary", async () => {
    const agent = makeAgent({ id: "agent2", channelId: "general", webhookId: "wh-general", webhookToken: "tok-general" });
    const store = fakeStore();
    const createWebhook = vi.fn(async () => ({ id: "wh-walletup", token: "tok-walletup" }));
    const client = fakeClientWithChannel(async () => [], createWebhook);

    const result = await ensureWebhook(client, store, "hub", agent, "walletup");

    expect(result).toEqual({ id: "wh-walletup", token: "tok-walletup" });
    expect(createWebhook).toHaveBeenCalledWith({ name: "hub-Jake" });
    expect(store.updateAgent).not.toHaveBeenCalled();
    // The agent's own-channel webhook must be untouched.
    expect(agent.webhookId).toBe("wh-general");
  });

  test("reuses an existing same-named webhook in the target channel instead of creating a duplicate", async () => {
    const agent = makeAgent({ id: "agent3", channelId: "general" });
    const createWebhook = vi.fn();
    const client = fakeClientWithChannel(
      async () => [{ name: "hub-Jake", token: "tok-existing" }],
      createWebhook,
    );

    const result = await ensureWebhook(client, fakeStore(), "hub", agent, "walletup");

    expect(result.token).toBe("tok-existing");
    expect(createWebhook).not.toHaveBeenCalled();
  });

  test("caches per (agent, channel) so a second call skips Discord entirely", async () => {
    const agent = makeAgent({ id: "agent4", channelId: "general" });
    const fetchWebhooks = vi.fn(async () => []);
    const createWebhook = vi.fn(async () => ({ id: "wh-x", token: "tok-x" }));
    const client = fakeClientWithChannel(fetchWebhooks, createWebhook);

    await ensureWebhook(client, fakeStore(), "hub", agent, "walletup");
    await ensureWebhook(client, fakeStore(), "hub", agent, "walletup");

    expect(createWebhook).toHaveBeenCalledTimes(1);
  });
});
