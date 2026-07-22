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

/** Ensure the agent has a webhook persona in the given channel; persist it. */
export async function ensureWebhook(
  client: Client,
  store: HubStore,
  prefix: string,
  agent: AgentRecord,
  channelId: string,
): Promise<{ id: string; token: string }> {
  if (agent.webhookId && agent.webhookToken) {
    return { id: agent.webhookId, token: agent.webhookToken };
  }
  const channel = await getTextChannel(client, channelId);
  const hooks = await channel.fetchWebhooks();
  const name = `${prefix}-${agent.name}`;
  const existing = hooks.find((h) => h.name === name && h.token);
  const hook = existing ?? (await channel.createWebhook({ name }));
  if (!hook.token) throw new Error(`Webhook for ${agent.name} has no token`);
  await store.updateAgent(agent.id, { webhookId: hook.id, webhookToken: hook.token });
  agent.webhookId = hook.id;
  agent.webhookToken = hook.token;
  return { id: hook.id, token: hook.token };
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
