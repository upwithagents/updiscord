import { describe, expect, test } from "vitest";
import { SqliteHubStore } from "./store/sqlite";
import type { HubConfig } from "./types";
import { undeliveredBacklog, validateConfig } from "./hub";

const valid: HubConfig = {
  token: "t",
  guildId: "g",
  agents: [{ name: "Advisor", kind: "advisor", channelId: "c1" }],
};

describe("validateConfig", () => {
  test("accepts a minimal valid config", () => {
    expect(() => validateConfig(valid)).not.toThrow();
  });

  test.each([
    [{ ...valid, token: "" }, /token/],
    [{ ...valid, guildId: "" }, /guildId/],
    [{ ...valid, agents: [] }, /agents/],
    [{ ...valid, agents: [{ name: "", kind: "k", channelId: "c" }] }, /name, kind and channelId/],
    [
      { ...valid, agents: [valid.agents[0], { name: "Advisor", kind: "x", channelId: "c2" }] },
      /duplicate agent name/,
    ],
  ])("rejects bad config %#", (config, message) => {
    expect(() => validateConfig(config as HubConfig)).toThrow(message);
  });
});

describe("undeliveredBacklog", () => {
  test("empty when the agent has seen everything", async () => {
    const store = new SqliteHubStore(":memory:");
    const agent = await store.ensureAgent({ name: "A", kind: "k", channelId: "c1", adapterPort: 4500 });
    await store.logMessage({ channelId: "c1", direction: "inbound", authorName: "laci", content: "hi" });
    await store.logMessage({ channelId: "c1", direction: "outbound", authorName: "A", agentId: agent.id, content: "yo" });
    expect(await undeliveredBacklog(store, agent)).toBe("");
    await store.close();
  });

  test("lists inbound messages after the agent's last outbound", async () => {
    const store = new SqliteHubStore(":memory:");
    const agent = await store.ensureAgent({ name: "A", kind: "k", channelId: "c1", adapterPort: 4500 });
    await store.logMessage({ channelId: "c1", direction: "outbound", authorName: "A", agentId: agent.id, content: "yo" });
    await store.logMessage({ channelId: "c1", direction: "inbound", authorName: "laci", content: "missed me?" });
    const backlog = await undeliveredBacklog(store, agent);
    expect(backlog).toContain("Messages received while you were offline:");
    expect(backlog).toContain("laci: missed me?");
    await store.close();
  });

  test("includes all inbound when the agent never spoke", async () => {
    const store = new SqliteHubStore(":memory:");
    const agent = await store.ensureAgent({ name: "A", kind: "k", channelId: "c1", adapterPort: 4500 });
    await store.logMessage({ channelId: "c1", direction: "inbound", authorName: "laci", content: "first ever" });
    expect(await undeliveredBacklog(store, agent)).toContain("first ever");
    await store.close();
  });
});
