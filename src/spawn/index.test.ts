import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { AgentRecord, HubStore } from "../types";
import { buildMcpConfigFile, tmuxSessionName, type SpawnConfig } from "./index";

const agent: AgentRecord = {
  id: "a1",
  name: "Advisor",
  kind: "advisor",
  channelId: "c1",
  webhookId: null,
  webhookToken: null,
  tmuxSession: null,
  adapterPort: 4500,
  status: "offline",
  listensGuildWide: false,
};

describe("tmuxSessionName", () => {
  test("prefixes the agent name", () => {
    expect(tmuxSessionName("updiscord", "Advisor")).toBe("updiscord-Advisor");
  });
});

describe("buildMcpConfigFile", () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  test("writes a 0600 config file containing adapter wiring and extra servers", () => {
    dir = mkdtempSync(join(tmpdir(), "updiscord-test-"));
    const cfg: SpawnConfig = {
      agent,
      store: {} as HubStore,
      hubUrl: "http://127.0.0.1:4400",
      cwd: "/tmp",
      adapterCommand: { command: "/repo/node_modules/.bin/tsx", args: ["/repo/src/my-adapter.ts"] },
      adapterEnv: { DATABASE_URL: "file:./app.db" },
      extraMcpServers: {
        wallet: { type: "http", url: "https://wallet.example", headers: { Authorization: "Bearer secret" } },
      },
      mcpConfigDir: dir,
    };
    const path = buildMcpConfigFile(cfg);

    expect(path).toBe(join(dir, "updiscord-mcp-a1.json"));
    // Secrets live in the file, not on any command line — must be owner-only.
    expect(statSync(path).mode & 0o777).toBe(0o600);

    const config = JSON.parse(readFileSync(path, "utf8"));
    expect(config.mcpServers["hub-adapter"]).toEqual({
      command: "/repo/node_modules/.bin/tsx",
      args: ["/repo/src/my-adapter.ts"],
      env: {
        AGENT_ID: "a1",
        AGENT_PORT: "4500",
        HUB_URL: "http://127.0.0.1:4400",
        DATABASE_URL: "file:./app.db",
      },
    });
    expect(config.mcpServers.wallet.headers.Authorization).toBe("Bearer secret");
  });

  test("throws when the agent has no adapterPort", () => {
    dir = mkdtempSync(join(tmpdir(), "updiscord-test-"));
    const cfg: SpawnConfig = {
      agent: { ...agent, adapterPort: null },
      store: {} as HubStore,
      hubUrl: "http://127.0.0.1:4400",
      cwd: "/tmp",
      adapterCommand: { command: "tsx", args: ["adapter.ts"] },
      mcpConfigDir: dir,
    };
    expect(() => buildMcpConfigFile(cfg)).toThrow(/adapterPort/);
  });
});
