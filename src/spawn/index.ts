/**
 * updiscord/spawn — tmux + Claude CLI agent orchestration (opt-in layer).
 *
 * Hosts with their own in-process agent loop (e.g. upagent) don't import
 * this. Hosts that run agents as Claude Code CLI processes (walletup-style)
 * use spawnAgent/killAgent.
 *
 * Secret handling: the MCP config (which can contain bearer tokens for
 * host MCP servers) is written to an owner-only (0600) file and passed to
 * claude by path — never inline on the command line where ps/tmux exposes it.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentRecord, HubStore } from "../types";

const DEV_CHANNELS_DIALOG_TEXT = "development channels";
const DEV_CHANNELS_READY_TEXT = "channel";
const DEV_CHANNELS_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 1_000;
const MCP_SETTLE_DELAY_MS = 5_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface SpawnConfig {
  agent: AgentRecord;
  store: HubStore;
  hubUrl: string;
  cwd: string;
  adapterCommand: { command: string; args: string[] };
  adapterEnv?: Record<string, string>;
  claudeAgent?: string;
  model?: string;
  extraMcpServers?: Record<string, unknown>;
  mcpConfigDir?: string;
  sessionPrefix?: string;
}

export function tmuxSessionName(prefix: string, agentName: string): string {
  return `${prefix}-${agentName}`;
}

function tmux(args: string[]) {
  return spawnSync("tmux", args, { encoding: "utf8" });
}

export function isTmuxSessionAlive(session: string): boolean {
  return tmux(["has-session", "-t", session]).status === 0;
}

/** Write the agent's MCP config to an owner-only file; return its path. */
export function buildMcpConfigFile(cfg: SpawnConfig): string {
  if (!cfg.agent.adapterPort) {
    throw new Error(`updiscord/spawn: agent ${cfg.agent.name} has no adapterPort`);
  }
  const dir = cfg.mcpConfigDir ?? tmpdir();
  mkdirSync(dir, { recursive: true });
  const config = {
    mcpServers: {
      "hub-adapter": {
        command: cfg.adapterCommand.command,
        args: cfg.adapterCommand.args,
        env: {
          AGENT_ID: cfg.agent.id,
          AGENT_PORT: String(cfg.agent.adapterPort),
          HUB_URL: cfg.hubUrl,
          ...cfg.adapterEnv,
        },
      },
      ...cfg.extraMcpServers,
    },
  };
  const path = join(dir, `updiscord-mcp-${cfg.agent.id}.json`);
  writeFileSync(path, JSON.stringify(config, null, 2), { mode: 0o600 });
  return path;
}

/**
 * Poll the tmux pane for the dev-channels dialog, dismiss it, then wait for
 * the ready banner (and MCP settling). Returns false on timeout. (Learning
 * ported from disco-factory: messages sent before the MCP server is wired
 * to the channel listener are silently dropped.)
 */
async function waitForClaudeReady(session: string): Promise<boolean> {
  const deadline = Date.now() + DEV_CHANNELS_TIMEOUT_MS;
  let enterSent = false;
  while (Date.now() < deadline) {
    const result = tmux(["capture-pane", "-t", session, "-p"]);
    if (result.status === 0) {
      const output = result.stdout.toLowerCase();
      if (enterSent && output.includes(DEV_CHANNELS_READY_TEXT)) {
        await sleep(MCP_SETTLE_DELAY_MS);
        return true;
      }
      if (!enterSent && output.includes(DEV_CHANNELS_DIALOG_TEXT)) {
        tmux(["send-keys", "-t", session, "Enter"]);
        enterSent = true;
      }
    }
    await sleep(POLL_INTERVAL_MS);
  }
  return false;
}

/** Spawn (or respawn) the agent's Claude CLI session in a detached tmux. */
export async function spawnAgent(cfg: SpawnConfig): Promise<void> {
  const prefix = cfg.sessionPrefix ?? "updiscord";
  const session = tmuxSessionName(prefix, cfg.agent.name);
  if (isTmuxSessionAlive(session)) {
    tmux(["kill-session", "-t", session]);
  }

  const mcpConfigPath = buildMcpConfigFile(cfg);

  const args = [
    "claude",
    ...(cfg.claudeAgent ? ["--agent", cfg.claudeAgent] : []),
    ...(cfg.model ? ["--model", cfg.model] : []),
    "--name", cfg.agent.name,
    "--dangerously-skip-permissions",
    "--dangerously-load-development-channels", "server:hub-adapter",
    // Only the servers in our config file — never the user's personal MCPs
    "--strict-mcp-config",
    "--mcp-config", mcpConfigPath,
  ];

  const result = tmux(["new-session", "-d", "-s", session, "-c", cfg.cwd, "--", ...args]);
  if (result.status !== 0) {
    throw new Error(`updiscord/spawn: tmux new-session failed: ${result.stderr}`);
  }

  await cfg.store.updateAgent(cfg.agent.id, { tmuxSession: session, status: "starting" });

  const ready = await waitForClaudeReady(session);
  if (!ready) {
    // No zombies: a session that never became ready gets killed and reported.
    tmux(["kill-session", "-t", session]);
    await cfg.store.updateAgent(cfg.agent.id, { status: "dead" });
    throw new Error(`updiscord/spawn: ${cfg.agent.name} did not become ready in ${DEV_CHANNELS_TIMEOUT_MS}ms`);
  }
  console.log(`[updiscord] ${cfg.agent.name} started in tmux session ${session}`);
}

export function killAgent(agent: AgentRecord): void {
  if (agent.tmuxSession && isTmuxSessionAlive(agent.tmuxSession)) {
    tmux(["kill-session", "-t", agent.tmuxSession]);
  }
}
