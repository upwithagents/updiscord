import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { SqliteHubStore } from "./sqlite";

describe("SqliteHubStore", () => {
  let store: SqliteHubStore;
  beforeEach(() => {
    store = new SqliteHubStore(":memory:");
  });
  afterEach(async () => {
    await store.close();
  });

  test("ensureAgent creates then returns the same agent, syncing config fields", async () => {
    const a = await store.ensureAgent({ name: "Advisor", kind: "advisor", channelId: "c1", adapterPort: 4500 });
    expect(a.id).toBeTruthy();
    expect(a.status).toBe("offline");

    const b = await store.ensureAgent({ name: "Advisor", kind: "advisor", channelId: "c2", adapterPort: 4501 });
    expect(b.id).toBe(a.id);
    expect(b.channelId).toBe("c2");
    expect(b.adapterPort).toBe(4501);
  });

  test("getAgent / getAgentByName / listAgents / updateAgent", async () => {
    const a = await store.ensureAgent({ name: "Advisor", kind: "advisor", channelId: "c1", adapterPort: 4500 });
    expect((await store.getAgent(a.id))?.name).toBe("Advisor");
    expect((await store.getAgentByName("Advisor"))?.id).toBe(a.id);
    expect((await store.getAgent("nope"))).toBeNull();

    await store.updateAgent(a.id, { status: "ready", webhookId: "wh1", webhookToken: "tok" });
    const updated = await store.getAgent(a.id);
    expect(updated?.status).toBe("ready");
    expect(updated?.webhookId).toBe("wh1");
    expect(updated?.webhookToken).toBe("tok");

    expect((await store.listAgents()).map((x) => x.name)).toEqual(["Advisor"]);
  });

  test("logMessage + channelHistory returns newest-first and respects limit", async () => {
    await store.logMessage({ channelId: "c1", direction: "inbound", authorName: "laci", content: "one" });
    await store.logMessage({ channelId: "c1", direction: "inbound", authorName: "laci", content: "two" });
    await store.logMessage({ channelId: "c2", direction: "inbound", authorName: "laci", content: "other" });

    const history = await store.channelHistory("c1", 10);
    expect(history.map((m) => m.content)).toEqual(["two", "one"]);
    expect(history[0].createdAt).toBeTruthy();

    expect((await store.channelHistory("c1", 1)).map((m) => m.content)).toEqual(["two"]);
  });

  test("discordId is unique-able and stored", async () => {
    await store.logMessage({ discordId: "d1", channelId: "c1", direction: "inbound", authorName: "laci", content: "x" });
    const [m] = await store.channelHistory("c1", 1);
    expect(m.discordId).toBe("d1");
  });

  test("inboundSince and lastOutboundId support backlog reconstruction", async () => {
    const a = await store.ensureAgent({ name: "Advisor", kind: "advisor", channelId: "c1", adapterPort: 4500 });

    expect(await store.lastOutboundId(a.id)).toBeNull();

    await store.logMessage({ channelId: "c1", direction: "inbound", authorName: "laci", content: "before" });
    await store.logMessage({ channelId: "c1", direction: "outbound", authorName: "Advisor", agentId: a.id, content: "reply" });
    await store.logMessage({ channelId: "c1", direction: "inbound", authorName: "laci", content: "missed 1" });
    await store.logMessage({ channelId: "c1", direction: "inbound", authorName: "laci", content: "missed 2" });

    const lastOut = await store.lastOutboundId(a.id);
    expect(lastOut).not.toBeNull();

    const missed = await store.inboundSince("c1", lastOut, 20);
    expect(missed.map((m) => m.content)).toEqual(["missed 1", "missed 2"]);

    const all = await store.inboundSince("c1", null, 20);
    expect(all.map((m) => m.content)).toEqual(["before", "missed 1", "missed 2"]);
  });
});
