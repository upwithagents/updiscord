/**
 * updiscord/adapter — MCP server bridging one Claude Code agent and the hub.
 *
 * Talks MCP JSON-RPC to Claude over stdio and HTTP to the hub. Built-in
 * tools: reply, read_channel, create_channel, spawn_persona. Host-specific
 * tools (proposals, memory, ...) are injected via AdapterOptions.extraTools.
 *
 * Stdout is reserved for MCP. ALL logging goes to stderr.
 */

import http from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type { MessageRecord } from "../types";

export interface AdapterTool {
  name: string;
  description: string;
  schema: Record<string, z.ZodTypeAny>;
  handler: (args: Record<string, unknown>) => Promise<string>;
}

export interface AdapterOptions {
  name?: string;
  version?: string;
  extraTools?: AdapterTool[];
}

function text(t: string) {
  return { content: [{ type: "text" as const, text: t }] };
}

/** Newest-first records → oldest-first "[iso] author: content" lines. */
export function formatHistory(messages: MessageRecord[]): string {
  const lines = [...messages]
    .reverse()
    .map((m) => `[${m.createdAt}] ${m.authorName}: ${m.content}`);
  return lines.join("\n") || "(no messages logged yet)";
}

export async function runAdapter(opts: AdapterOptions = {}): Promise<void> {
  const HUB_URL = process.env.HUB_URL;
  const AGENT_ID = process.env.AGENT_ID;
  const AGENT_PORT = Number(process.env.AGENT_PORT);

  if (!HUB_URL || !AGENT_ID || !AGENT_PORT) {
    console.error("[adapter] missing required env: HUB_URL, AGENT_ID, AGENT_PORT");
    process.exit(1);
  }

  const server = new McpServer(
    { name: opts.name ?? "updiscord-adapter", version: opts.version ?? "0.1.0" },
    { capabilities: { experimental: { "claude/channel": {} } } },
  );

  server.tool(
    "reply",
    "Send a message to a Discord channel. This is your ONLY way to talk to the user — use it for every response to <channel> messages.",
    {
      channel: z.string().describe("The channel_id from the <channel> tag"),
      content: z.string().describe("Your message (Discord markdown, max ~1900 chars per message)"),
    },
    async ({ channel, content }) => {
      const res = await fetch(`${HUB_URL}/agents/${AGENT_ID}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel_id: channel, content }),
      });
      if (!res.ok) {
        const t = await res.text();
        console.error(`[adapter] reply failed: ${res.status} ${t}`);
        return text(`Error: ${t}`);
      }
      return text("Reply sent.");
    },
  );

  server.tool(
    "read_channel",
    "Read recent messages from a Discord channel (from the hub's audit log).",
    {
      channel_id: z.string(),
      limit: z.number().optional().describe("Default 30, max 100"),
    },
    async ({ channel_id, limit }) => {
      const url = `${HUB_URL}/channels/${channel_id}/messages?limit=${limit ?? 30}`;
      const res = await fetch(url);
      if (!res.ok) {
        const t = await res.text();
        console.error(`[adapter] read_channel failed: ${res.status} ${t}`);
        return text(`Error: ${t}`);
      }
      const body = (await res.json()) as { messages: MessageRecord[] };
      return text(formatHistory(body.messages));
    },
  );

  server.tool(
    "create_channel",
    "Create a new Discord text channel in this instance's server. Returns its channel_id.",
    {
      name: z.string().describe("Channel name (Discord lowercases/hyphenates it)"),
    },
    async ({ name }) => {
      const res = await fetch(`${HUB_URL}/mgmt/create-channel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const t = await res.text();
        console.error(`[adapter] create_channel failed: ${res.status} ${t}`);
        return text(`Error: ${t}`);
      }
      const body = (await res.json()) as { channel_id: string };
      return text(`Created #${name} (channel_id ${body.channel_id}).`);
    },
  );

  server.tool(
    "spawn_persona",
    "Register and launch a new persistent persona (its own Claude Code session) in this " +
      "instance, listening in the given channel. Use after create_channel if the persona needs " +
      "a fresh channel of its own.",
    {
      name: z.string().describe("Unique persona name, e.g. Sandra"),
      kind: z.string().describe("Short role label, e.g. financial-advisor"),
      channel_id: z.string().describe("Discord channel_id the persona will listen/reply in"),
      cwd: z.string().describe("Working directory for the persona's Claude Code session"),
      adapter_command: z.string().describe("Command to launch its MCP adapter, e.g. npx"),
      adapter_args: z.array(z.string()).describe("Args for adapter_command"),
      claude_agent: z
        .string()
        .optional()
        .describe("Name of a .claude/agents/<name>.md persona definition in cwd"),
      model: z.string().optional(),
      onboarding_message: z.string().optional().describe("Greeting sent once the persona is ready"),
    },
    async (args) => {
      const res = await fetch(`${HUB_URL}/mgmt/spawn-persona`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: args.name,
          kind: args.kind,
          channelId: args.channel_id,
          cwd: args.cwd,
          adapterCommand: { command: args.adapter_command, args: args.adapter_args },
          claudeAgent: args.claude_agent,
          model: args.model,
          onboardingMessage: args.onboarding_message,
        }),
      });
      if (!res.ok) {
        const t = await res.text();
        console.error(`[adapter] spawn_persona failed: ${res.status} ${t}`);
        return text(`Error: ${t}`);
      }
      const body = (await res.json()) as { agentId: string };
      return text(`Spawned ${args.name} (agent_id ${body.agentId}). It should come online shortly.`);
    },
  );

  for (const tool of opts.extraTools ?? []) {
    server.tool(tool.name, tool.description, tool.schema, async (args: Record<string, unknown>) =>
      text(await tool.handler(args)),
    );
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[adapter] MCP connected for agent ${AGENT_ID}`);

  // HTTP listener: the hub POSTs inbound Discord messages here; we forward
  // them to Claude as channel notifications (delivered between turns).
  const httpServer = http.createServer((req, res) => {
    if (req.method === "POST" && req.url === "/message") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", async () => {
        try {
          const msg = JSON.parse(body) as {
            channel_id: string;
            channel_name: string;
            author: string;
            content: string;
            message_id: string;
          };
          console.error(`[adapter] message from ${msg.author} in #${msg.channel_name}`);
          await server.server.notification({
            method: "notifications/claude/channel",
            params: {
              content: msg.content,
              meta: {
                author: msg.author,
                channel_name: msg.channel_name,
                channel_id: msg.channel_id,
                message_id: msg.message_id,
              },
            },
          });
          res.writeHead(200).end("ok");
        } catch (e) {
          console.error(`[adapter] bad /message payload: ${e}`);
          res.writeHead(400).end("bad request");
        }
      });
      return;
    }
    res.writeHead(404).end("not found");
  });
  httpServer.listen(AGENT_PORT, "127.0.0.1", () => {
    console.error(`[adapter] HTTP listening on 127.0.0.1:${AGENT_PORT}`);
  });

  // Tell the hub we're ready (it will deliver the boot message + backlog).
  for (let i = 0; i < 30; i++) {
    try {
      await fetch(`${HUB_URL}/agents/${AGENT_ID}/ready`, { method: "POST" });
      console.error("[adapter] signaled ready to hub");
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  console.error("[adapter] hub unreachable after 30 retries");
}
