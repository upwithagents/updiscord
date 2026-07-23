/**
 * startHub: one call wires the whole control plane — store, agent registry,
 * Discord gateway, inbound debounce → adapter delivery, control API,
 * onboarding + backlog replay on agent ready.
 */

import { exec } from "node:child_process";
import { Events } from "discord.js";
import { startApi } from "./api";
import { DebounceBuffer, type BufferedMessage } from "./debounce";
import { createClient, createGuildChannel, isEcho, sendAsAgent } from "./discord";
import { SqliteHubStore } from "./store/sqlite";
import type { AgentRecord, Hub, HubConfig, HubStore, SpawnPersonaInput } from "./types";

export function runOnReadyHook(hook: string | undefined): void {
  if (!hook) return;
  exec(hook, (err, stdout, stderr) => {
    if (err) {
      console.error(`[updiscord] onReadyHook failed: ${err.message}`);
      return;
    }
    if (stdout.trim()) console.log(`[updiscord] onReadyHook stdout: ${stdout.trim()}`);
    if (stderr.trim()) console.error(`[updiscord] onReadyHook stderr: ${stderr.trim()}`);
  });
}

const DEFAULT_HTTP_PORT = 4400;
const DEFAULT_ADAPTER_BASE_PORT = 4500;
const BACKLOG_LIMIT = 20;

export function validateConfig(config: HubConfig): void {
  if (!config.token) throw new Error("updiscord: config.token is required (Discord bot token)");
  if (!config.guildId) throw new Error("updiscord: config.guildId is required");
  if (!config.agents || config.agents.length === 0) {
    throw new Error("updiscord: config.agents must contain at least one agent");
  }
  const names = new Set<string>();
  for (const a of config.agents) {
    if (!a.name || !a.kind || !a.channelId) {
      throw new Error(
        `updiscord: agent entries need name, kind and channelId (got ${JSON.stringify(a)})`,
      );
    }
    if (names.has(a.name)) throw new Error(`updiscord: duplicate agent name ${a.name}`);
    names.add(a.name);
  }
}

/** POST a message batch to the agent's adapter. */
async function deliverToAgent(
  agent: AgentRecord,
  channelName: string,
  messages: BufferedMessage[],
): Promise<boolean> {
  if (!agent.adapterPort) return false;
  const combined = messages.map((m) => `${m.author}: ${m.content}`).join("\n");
  try {
    const res = await fetch(`http://127.0.0.1:${agent.adapterPort}/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channel_id: messages[0].channelId,
        channel_name: channelName,
        author: messages.length === 1 ? messages[0].author : "multiple",
        content: combined,
        message_id: messages[messages.length - 1].messageId,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function deliverSystemMessage(agent: AgentRecord, content: string): Promise<boolean> {
  return deliverToAgent(agent, "system", [
    {
      channelId: agent.channelId,
      channelName: "system",
      author: "system",
      content,
      messageId: `system-${Date.now()}`,
    },
  ]);
}

/** Inbound messages the agent missed since its last outbound, as a prompt suffix. */
export async function undeliveredBacklog(store: HubStore, agent: AgentRecord): Promise<string> {
  const lastOut = await store.lastOutboundId(agent.id);
  const missed = await store.inboundSince(agent.channelId, lastOut, BACKLOG_LIMIT);
  if (missed.length === 0) return "";
  const lines = missed.map((m) => `[${m.createdAt}] ${m.authorName}: ${m.content}`);
  return `\n\nMessages received while you were offline:\n${lines.join("\n")}`;
}

function defaultOnboarding(agent: AgentRecord): string {
  return (
    `You are ${agent.name}, now online (channel_id: ${agent.channelId}). ` +
    `Greet the user briefly (1-2 sentences) using the reply tool and mention ` +
    `what you can help with right now.`
  );
}

export async function startHub(config: HubConfig): Promise<Hub> {
  validateConfig(config);

  const store = config.store ?? new SqliteHubStore(config.storePath ?? "./updiscord.db");
  // Discord rejects any webhook/username containing "discord" (case-insensitive)
  // — "updiscord" as a default would break webhook creation for every new agent.
  const webhookPrefix = config.webhookPrefix ?? "hub";
  const basePort = config.adapterBasePort ?? DEFAULT_ADAPTER_BASE_PORT;

  const agents: AgentRecord[] = [];
  for (const [i, a] of config.agents.entries()) {
    agents.push(
      await store.ensureAgent({
        name: a.name,
        kind: a.kind,
        channelId: a.channelId,
        adapterPort: basePort + i,
        listensGuildWide: a.listensGuildWide,
      }),
    );
  }
  const onboarding = new Map(config.agents.map((a) => [a.name, a.onboardingMessage]));
  const onReadyHooks = new Map(config.agents.map((a) => [a.name, a.onReadyHook]));
  let nextAdapterPort = basePort + config.agents.length;

  const client = createClient();

  async function spawnPersona(input: SpawnPersonaInput): Promise<{ agentId: string }> {
    if (await store.getAgentByName(input.name)) {
      throw new Error(`updiscord: agent ${input.name} already exists`);
    }
    const agent = await store.ensureAgent({
      name: input.name,
      kind: input.kind,
      channelId: input.channelId,
      adapterPort: nextAdapterPort++,
      listensGuildWide: input.listensGuildWide,
    });
    onboarding.set(input.name, input.onboardingMessage);
    await config.onPersonaSpawned?.(agent, input);
    return { agentId: agent.id };
  }

  const buffer = new DebounceBuffer(async (channelId, messages) => {
    for (const agent of await store.listAgents()) {
      if (agent.channelId !== channelId && !agent.listensGuildWide) continue;
      const ok = await deliverToAgent(agent, messages[0].channelName, messages);
      if (!ok) {
        console.warn(
          `[updiscord] delivery to ${agent.name} failed — adapter down? Messages stay in the audit log.`,
        );
      }
    }
  });

  client.on(Events.MessageCreate, async (message) => {
    if (isEcho(client, message)) return;
    if (message.guildId !== config.guildId) return;
    try {
      await store.logMessage({
        discordId: message.id,
        channelId: message.channelId,
        direction: "inbound",
        authorName: message.author.username,
        content: message.content,
      });
    } catch (e) {
      console.error(`[updiscord] audit log write failed for inbound message: ${e}`);
    }
    buffer.push({
      channelId: message.channelId,
      channelName:
        "name" in message.channel && message.channel.name ? message.channel.name : "?",
      author: message.author.username,
      content: message.content,
      messageId: message.id,
    });
  });

  const api = startApi({
    port: config.httpPort ?? DEFAULT_HTTP_PORT,
    store,
    send: (agent, channelId, content) =>
      sendAsAgent(client, store, webhookPrefix, agent, channelId, content),
    createChannel: (name) => createGuildChannel(client, config.guildId, name),
    spawnPersona,
    onReady: async (agent) => {
      const backlog = await undeliveredBacklog(store, agent);
      const message = onboarding.get(agent.name) ?? defaultOnboarding(agent);
      await deliverSystemMessage(agent, message + backlog);
      runOnReadyHook(onReadyHooks.get(agent.name));
    },
  });

  await new Promise<void>((resolve, reject) => {
    client.once(Events.ClientReady, () => resolve());
    client.login(config.token).catch(reject);
  });
  console.log(`[updiscord] Discord connected as ${client.user?.tag}`);

  return {
    client,
    store,
    agents,
    sendAsAgent: async (agentName, channelId, content) => {
      const agent = await store.getAgentByName(agentName);
      if (!agent) throw new Error(`updiscord: unknown agent ${agentName}`);
      await sendAsAgent(client, store, webhookPrefix, agent, channelId, content);
    },
    stop: async () => {
      await new Promise<void>((r) => api.close(() => r()));
      await client.destroy();
      await store.close();
    },
  };
}
