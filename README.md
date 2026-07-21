<img src="docs/icon.svg" width="56" align="left" alt="" />

# updiscord

Discord control-plane library for up-ecosystem apps: one bot connection
per app, many agent personas over webhooks, message audit log, offline
backlog replay, and optional tmux/Claude-CLI agent orchestration.

<br clear="left"/>

## Install

```bash
npm install github:upwithagents/updiscord#v0.1.0
```

Ships TypeScript source (no build) — run your app under `tsx`, like every
up-ecosystem app already does.

## Discord bot setup (once per app)

1. Create an application + bot at https://discord.com/developers/applications
2. Enable the **Presence**, **Server Members**, and **Message Content** intents (Bot tab, "Privileged Gateway Intents").
3. Invite it with: View Channels, Send Messages, Read Message History, Manage Channels, Manage Roles, Manage Webhooks.
4. Pass the bot token, guild id, and channel ids from your app's own `.env`.

## Usage

```ts
import { startHub } from "updiscord";

const hub = await startHub({
  token: process.env.DISCORD_TOKEN!,
  guildId: process.env.DISCORD_GUILD_ID!,
  agents: [{ name: "Advisor", kind: "advisor", channelId: process.env.DISCORD_GENERAL_CHANNEL_ID! }],
  storePath: "./data/updiscord.db",
});

await hub.sendAsAgent("Advisor", process.env.DISCORD_GENERAL_CHANNEL_ID!, "hello!");
```

Inbound messages are audit-logged and delivered to each agent's adapter.
Optional: spawn a full Claude CLI agent per persona (`updiscord/spawn`), or
bring your own storage via the `HubStore` interface (`src/types.ts`).

## Development

```bash
npm install
npm test
npm run typecheck
```
