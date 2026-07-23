import http from "node:http";
import type { AgentRecord, HubStore, SpawnPersonaInput } from "./types";

export interface ApiOptions {
  port: number;
  store: HubStore;
  send: (agent: AgentRecord, channelId: string, content: string) => Promise<void>;
  onReady: (agent: AgentRecord) => Promise<void>;
  createChannel: (name: string) => Promise<string>;
  spawnPersona: (input: SpawnPersonaInput) => Promise<{ agentId: string }>;
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => resolve(body));
  });
}

export function startApi(opts: ApiOptions): http.Server {
  const { store, send, onReady, createChannel, spawnPersona } = opts;
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");

      const agentMatch = url.pathname.match(/^\/agents\/([^/]+)\/(reply|ready)$/);
      if (agentMatch && req.method === "POST") {
        const [, agentId, action] = agentMatch;
        const agent = await store.getAgent(agentId);
        if (!agent) {
          res.writeHead(404).end("unknown agent");
          return;
        }

        if (action === "reply") {
          const { channel_id, content } = JSON.parse(await readBody(req)) as {
            channel_id: string;
            content: string;
          };
          await send(agent, channel_id, content);
          await store.updateAgent(agent.id, { status: "ready" });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ status: "ok" }));
          return;
        }

        // action === "ready"
        console.log(`[updiscord] agent ${agent.name} adapter ready`);
        await store.updateAgent(agent.id, { status: "ready" });
        await onReady(agent);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
        return;
      }

      const channelMatch = url.pathname.match(/^\/channels\/([^/]+)\/messages$/);
      if (channelMatch && req.method === "GET") {
        const limitParam = Number(url.searchParams.get("limit") ?? 30);
        const limit = Math.max(1, Math.min(Number.isFinite(limitParam) ? limitParam : 30, 100));
        const messages = await store.channelHistory(channelMatch[1], limit);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ messages }));
        return;
      }

      if (url.pathname === "/mgmt/create-channel" && req.method === "POST") {
        const { name } = JSON.parse(await readBody(req)) as { name?: string };
        if (!name) {
          res.writeHead(400).end("name is required");
          return;
        }
        const channelId = await createChannel(name);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ channel_id: channelId }));
        return;
      }

      if (url.pathname === "/mgmt/spawn-persona" && req.method === "POST") {
        const input = JSON.parse(await readBody(req)) as Partial<SpawnPersonaInput>;
        if (!input.name || !input.kind || !input.channelId || !input.cwd || !input.adapterCommand) {
          res.writeHead(400).end("name, kind, channelId, cwd and adapterCommand are required");
          return;
        }
        const result = await spawnPersona(input as SpawnPersonaInput);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
        return;
      }

      res.writeHead(404).end("not found");
    } catch (e) {
      console.error(`[updiscord] api error: ${e}`);
      res.writeHead(500).end(String(e));
    }
  });

  server.listen(opts.port, "127.0.0.1", () => {
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : opts.port;
    console.log(`[updiscord] api listening on 127.0.0.1:${port}`);
  });
  return server;
}
