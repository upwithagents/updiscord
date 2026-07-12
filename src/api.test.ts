import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type http from "node:http";
import type { AgentRecord, HubStore, MessageRecord } from "./types";
import { startApi } from "./api";

const agent: AgentRecord = {
  id: "a1",
  name: "Advisor",
  kind: "advisor",
  channelId: "c1",
  webhookId: null,
  webhookToken: null,
  tmuxSession: null,
  adapterPort: 4500,
  status: "offline",
};

const history: MessageRecord[] = [
  { id: 2, discordId: null, channelId: "c1", direction: "inbound", authorName: "laci", agentId: null, content: "two", createdAt: "2026-07-12T10:00:01.000Z" },
  { id: 1, discordId: null, channelId: "c1", direction: "inbound", authorName: "laci", agentId: null, content: "one", createdAt: "2026-07-12T10:00:00.000Z" },
];

function stubStore(): HubStore {
  return {
    ensureAgent: vi.fn(),
    getAgent: vi.fn(async (id: string) => (id === "a1" ? agent : null)),
    getAgentByName: vi.fn(),
    listAgents: vi.fn(),
    updateAgent: vi.fn(async () => {}),
    logMessage: vi.fn(),
    channelHistory: vi.fn(async () => history),
    inboundSince: vi.fn(),
    lastOutboundId: vi.fn(),
    close: vi.fn(),
  } as unknown as HubStore;
}

describe("startApi", () => {
  let server: http.Server;
  let base: string;
  let store: HubStore;
  const send = vi.fn(async () => {});
  const onReady = vi.fn(async () => {});

  beforeEach(async () => {
    vi.clearAllMocks();
    store = stubStore();
    server = startApi({ port: 0, store, send, onReady });
    await new Promise<void>((r) => server.once("listening", () => r()));
    const addr = server.address();
    if (typeof addr !== "object" || !addr) throw new Error("no address");
    base = `http://127.0.0.1:${addr.port}`;
  });

  afterEach(() => new Promise<void>((r) => server.close(() => r())));

  test("POST /agents/:id/reply sends via the agent and marks it ready", async () => {
    const res = await fetch(`${base}/agents/a1/reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel_id: "c1", content: "hi" }),
    });
    expect(res.status).toBe(200);
    expect(send).toHaveBeenCalledWith(agent, "c1", "hi");
    expect(store.updateAgent).toHaveBeenCalledWith("a1", { status: "ready" });
  });

  test("POST /agents/:id/ready marks ready and fires onReady", async () => {
    const res = await fetch(`${base}/agents/a1/ready`, { method: "POST" });
    expect(res.status).toBe(200);
    expect(store.updateAgent).toHaveBeenCalledWith("a1", { status: "ready" });
    expect(onReady).toHaveBeenCalledWith(agent);
  });

  test("unknown agent returns 404", async () => {
    const res = await fetch(`${base}/agents/nope/ready`, { method: "POST" });
    expect(res.status).toBe(404);
  });

  test("GET /channels/:id/messages returns history newest-first", async () => {
    const res = await fetch(`${base}/channels/c1/messages?limit=2`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { messages: MessageRecord[] };
    expect(body.messages.map((m) => m.content)).toEqual(["two", "one"]);
    expect(store.channelHistory).toHaveBeenCalledWith("c1", 2);
  });

  test("GET limit is clamped to 100 and defaults to 30", async () => {
    await fetch(`${base}/channels/c1/messages?limit=500`);
    expect(store.channelHistory).toHaveBeenCalledWith("c1", 100);
    await fetch(`${base}/channels/c1/messages`);
    expect(store.channelHistory).toHaveBeenCalledWith("c1", 30);
  });

  test("unmatched routes return 404", async () => {
    const res = await fetch(`${base}/whatever`);
    expect(res.status).toBe(404);
  });
});
