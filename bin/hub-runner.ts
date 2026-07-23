// updiscord/bin/hub-runner.ts
/**
 * One instance's long-running process: connects to Discord, then spawns
 * every configured persona's Claude CLI in its own tmux session. Started
 * inside tmux by `bin/updiscord.ts start <id>` — never run directly in a
 * foreground shell for a real instance.
 */

import { config as loadEnv } from "dotenv";
import { readFileSync, writeFileSync } from "node:fs";
import { startHub } from "../src/hub";
import {
  instanceConfigPath,
  instanceDbPath,
  instanceEnvPath,
  instanceMcpConfigDir,
} from "../src/instance/paths";
import { parseInstanceConfig, type PersonaConfig } from "../src/instance/config";
import { spawnAgent } from "../src/spawn";

function requireArg(name: string): string {
  const idx = process.argv.indexOf(`--${name}`);
  const value = idx === -1 ? undefined : process.argv[idx + 1];
  if (!value) {
    console.error(`updiscord: --${name} is required`);
    process.exit(1);
  }
  return value;
}

async function main(): Promise<void> {
  const instanceId = requireArg("instance");
  const raw = JSON.parse(readFileSync(instanceConfigPath(instanceId), "utf8"));
  const config = parseInstanceConfig(raw);

  loadEnv({ path: instanceEnvPath(instanceId) });
  const token = process.env[config.discordTokenEnv];
  if (!token) {
    console.error(
      `updiscord: ${config.discordTokenEnv} is not set (check ${instanceEnvPath(instanceId)})`,
    );
    process.exit(1);
  }

  const hubUrl = `http://127.0.0.1:${config.hubPort}`;
  let hub: Awaited<ReturnType<typeof startHub>>;

  hub = await startHub({
    token,
    guildId: config.guildId,
    agents: config.personas.map((p) => ({
      name: p.name,
      kind: p.kind,
      channelId: p.channelId,
      onboardingMessage: p.onboardingMessage,
      onReadyHook: p.onReadyHook,
      listensGuildWide: p.listensGuildWide,
    })),
    httpPort: config.hubPort,
    adapterBasePort: config.adapterBasePort,
    storePath: instanceDbPath(instanceId),
    onPersonaSpawned: async (agent, input) => {
      // Persist so the new persona survives a hub restart, and launch its
      // Claude CLI session immediately so it's usable right away.
      const persona: PersonaConfig = {
        name: input.name,
        kind: input.kind,
        channelId: input.channelId,
        cwd: input.cwd,
        adapterCommand: input.adapterCommand,
        adapterEnv: input.adapterEnv,
        claudeAgent: input.claudeAgent,
        model: input.model,
        onboardingMessage: input.onboardingMessage,
        listensGuildWide: input.listensGuildWide,
      };
      config.personas.push(persona);
      writeFileSync(instanceConfigPath(instanceId), JSON.stringify(config, null, 2));

      await spawnAgent({
        agent,
        store: hub.store,
        hubUrl,
        cwd: input.cwd,
        adapterCommand: input.adapterCommand,
        adapterEnv: input.adapterEnv,
        claudeAgent: input.claudeAgent,
        model: input.model,
        mcpConfigDir: instanceMcpConfigDir(instanceId),
        sessionPrefix: instanceId,
      });
    },
  });

  for (const persona of config.personas) {
    const agent = hub.agents.find((a) => a.name === persona.name);
    if (!agent) throw new Error(`updiscord: agent ${persona.name} missing after startHub`);
    await spawnAgent({
      agent,
      store: hub.store,
      hubUrl,
      cwd: persona.cwd,
      adapterCommand: persona.adapterCommand,
      adapterEnv: persona.adapterEnv,
      claudeAgent: persona.claudeAgent,
      model: persona.model,
      extraMcpServers: persona.extraMcpServers,
      mcpConfigDir: instanceMcpConfigDir(instanceId),
      sessionPrefix: instanceId,
    });
  }
}

main().catch((e) => {
  console.error(`[updiscord] hub-runner fatal: ${e}`);
  process.exit(1);
});
