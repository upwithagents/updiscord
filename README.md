# updiscord

Discord control-plane library for up-ecosystem apps (walletup, sheetup,
upagent, avatarup, homeup, cleanup). One bot connection per app, many agent
personas over webhooks, message audit log, offline backlog replay, and
optional tmux/Claude-CLI agent orchestration.

Extracted from walletup's hub; architecture patterns borrowed from
disco-factory (single gateway login multiplexing webhook identities,
SQLite registry, small HTTP control API).

## Install

Stable (git dependency):

```bash
npm install github:upwithagents/updiscord#v0.1.0
```

Local development (sibling checkout in ~/Documents/work):

```bash
npm install ../updiscord
# or: pnpm link ../updiscord
```

This package ships TypeScript source (no build). Run your app under `tsx`
(or another TS-capable loader), as every up-ecosystem app already does.

## Discord bot setup (once per app)

1. Create an application + bot at https://discord.com/developers/applications
2. Enable the **Message Content** intent.
3. Invite it to your guild with permissions: View Channel, Send Messages,
   Manage Webhooks.
4. Put the bot token, guild id and channel ids in your app's `.env` —
   updiscord itself never reads env; you pass values in.

## Usage

### Core hub

```ts
import { startHub } from "updiscord";

const hub = await startHub({
  token: process.env.DISCORD_TOKEN!,
  guildId: process.env.DISCORD_GUILD_ID!,
  agents: [
    {
      name: "Advisor",
      kind: "advisor",
      channelId: process.env.DISCORD_GENERAL_CHANNEL_ID!,
      onboardingMessage: "You are Advisor... greet the user briefly.",
    },
  ],
  storePath: "./data/updiscord.db",
});

// Post as a persona directly (no agent process needed):
await hub.sendAsAgent("Advisor", process.env.DISCORD_GENERAL_CHANNEL_ID!, "hello!");
```

Inbound guild messages are audit-logged and delivered (debounced) to the
adapter of every agent registered on that channel via
`POST 127.0.0.1:<adapterPort>/message`.

### Spawning Claude CLI agents (optional)

```ts
import { spawnAgent } from "updiscord/spawn";

await spawnAgent({
  agent: hub.agents[0],
  store: hub.store,
  hubUrl: "http://127.0.0.1:4400",
  cwd: REPO_ROOT,
  adapterCommand: {
    command: `${REPO_ROOT}/node_modules/.bin/tsx`,
    args: [`${REPO_ROOT}/src/discord-adapter.ts`],
  },
  claudeAgent: "myapp-advisor",
  model: "claude-sonnet-5",
  extraMcpServers: {
    /* your app's MCP servers; secrets end up in a 0600 config file, not on the command line */
  },
});
```

### Adapter entry (the file adapterCommand points at)

```ts
import { runAdapter } from "updiscord/adapter";
import { z } from "zod";

await runAdapter({
  name: "myapp-adapter",
  extraTools: [
    {
      name: "list_things",
      description: "List my app's things",
      schema: { limit: z.number().optional() },
      handler: async ({ limit }) => `things: ...`,
    },
  ],
});
```

### Custom storage

Implement the `HubStore` interface (see `src/types.ts`) to keep the agent
registry and audit log in your app's own database; pass it as
`store` to `startHub`. Default: a self-contained SQLite file.

## Development

```bash
npm install
npm test
npm run typecheck
```
