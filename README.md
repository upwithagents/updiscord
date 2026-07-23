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

## Running as a multi-instance factory

Rather than importing `updiscord` as a library once per app, you can run it
as a standalone process — one per user/tenant, each with its own Discord
bot, storage, ports, and personas — supervised by tmux. This is how apps
like walletup run in practice: one instance per user, with a persona per
app that user has enabled, all in one Discord server.

```bash
npm run cli -- create <instance-id>      # allocates ports, writes instances/<id>.json
# edit instances/<id>.json: guildId + personas (name, channelId, adapterCommand, ...)
# create .env.<instance-id> with the token env var name the create step printed

npm run cli -- start <instance-id>       # tmux session <id>-hub runs bin/hub-runner.ts,
                                          # which spawns one tmux session per persona
npm run cli -- list                      # id / running-or-stopped / hubPort / personas
npm run cli -- logs <instance-id>        # tmux capture-pane of the hub process
npm run cli -- stop <instance-id>        # kills <id>-hub and every <id>-* persona session
```

Each instance gets its own `instances/<id>.json` (committed — no secrets),
`.env.<id>` (gitignored — the Discord token), `data/<id>.db` (gitignored —
its `SqliteHubStore`), and `.mcp-config/<id>/` (gitignored — per-persona MCP
wiring). A persona's `onReadyHook` is an optional shell command exec'd once
after that persona's onboarding message is delivered — e.g. to kick off an
app-specific cron. See `src/instance/config.ts` for the full config shape.

## Development

```bash
npm install
npm test
npm run typecheck
```
