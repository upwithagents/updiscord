import {
  ChannelType,
  Client,
  GatewayIntentBits,
  WebhookClient,
  type Message,
  type TextChannel,
} from "discord.js";
import { splitMessage } from "./split";
import type { AgentRecord, HubStore } from "./types";

export function createClient(): Client {
  return new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildPresences,
      GatewayIntentBits.GuildMembers,
    ],
  });
}

export async function getTextChannel(client: Client, channelId: string): Promise<TextChannel> {
  const channel = await client.channels.fetch(channelId);
  if (!channel || channel.type !== ChannelType.GuildText) {
    throw new Error(`Channel ${channelId} is not a guild text channel`);
  }
  return channel;
}

/** Create a new text channel in the instance's guild. Requires the bot to have Manage Channels. */
export async function createGuildChannel(client: Client, guildId: string, name: string): Promise<string> {
  const guild = await client.guilds.fetch(guildId);
  const channel = await guild.channels.create({ name, type: ChannelType.GuildText });
  return channel.id;
}

/**
 * Discord webhooks are bound to a single channel, so an agent that talks in
 * more than one channel (listensGuildWide, or a one-off reply elsewhere)
 * needs one webhook per channel. Cached in memory per (agentId, channelId);
 * only the agent's own bound channel is persisted to the store, preserving
 * the original single-channel fast path across hub restarts.
 */
const webhookCache = new Map<string, { id: string; token: string }>();

function webhookCacheKey(agentId: string, channelId: string): string {
  return `${agentId}:${channelId}`;
}

/** Ensure the agent has a webhook persona in the given channel. */
export async function ensureWebhook(
  client: Client,
  store: HubStore,
  prefix: string,
  agent: AgentRecord,
  channelId: string,
): Promise<{ id: string; token: string }> {
  const key = webhookCacheKey(agent.id, channelId);
  const cached = webhookCache.get(key);
  if (cached) return cached;

  if (channelId === agent.channelId && agent.webhookId && agent.webhookToken) {
    const hook = { id: agent.webhookId, token: agent.webhookToken };
    webhookCache.set(key, hook);
    return hook;
  }

  const channel = await getTextChannel(client, channelId);
  const hooks = await channel.fetchWebhooks();
  const name = `${prefix}-${agent.name}`;
  const existing = hooks.find((h) => h.name === name && h.token);
  const hook = existing ?? (await channel.createWebhook({ name }));
  if (!hook.token) throw new Error(`Webhook for ${agent.name} has no token`);
  const result = { id: hook.id, token: hook.token };
  webhookCache.set(key, result);

  if (channelId === agent.channelId) {
    await store.updateAgent(agent.id, { webhookId: hook.id, webhookToken: hook.token });
    agent.webhookId = hook.id;
    agent.webhookToken = hook.token;
  }
  return result;
}

/** Post as the agent's persona via its webhook and log to the audit trail. */
export async function sendAsAgent(
  client: Client,
  store: HubStore,
  prefix: string,
  agent: AgentRecord,
  channelId: string,
  content: string,
): Promise<void> {
  const { id, token } = await ensureWebhook(client, store, prefix, agent, channelId);
  const webhook = new WebhookClient({ id, token });
  for (const chunk of splitMessage(content)) {
    await webhook.send({ content: chunk, username: agent.name });
  }
  try {
    await store.logMessage({
      channelId,
      direction: "outbound",
      authorName: agent.name,
      agentId: agent.id,
      content,
    });
  } catch (e) {
    // Delivery to Discord succeeded; a failed audit write must not fail the send.
    console.error(`[updiscord] audit log write failed (message was sent): ${e}`);
  }
}

/** True for messages the hub should ignore (its own personas / the bot). */
export function isEcho(client: Client, message: Message): boolean {
  if (message.author.id === client.user?.id) return true;
  if (message.webhookId) return true;
  return false;
}
