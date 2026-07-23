// updiscord/bin/updiscord.ts
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { InstanceConfigSchema, buildSkeletonConfig, type InstanceConfig } from "../src/instance/config";
import { INSTANCE_ROOT, instanceConfigPath, instancesDir } from "../src/instance/paths";

function tmux(args: string[]) {
  return spawnSync("tmux", args, { encoding: "utf8" });
}

function requireId(v: string | undefined): string {
  if (!v) {
    console.error("updiscord: instance id is required");
    process.exit(1);
  }
  return v;
}

function listInstanceConfigs(): InstanceConfig[] {
  const dir = instancesDir();
  if (!existsSync(dir)) return [];
  // Validate shape but skip the personas>=1 gate: a freshly created skeleton
  // legitimately has zero personas until a human fills it in, and `list`
  // must still be able to show it as "stopped ... (none configured)".
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => InstanceConfigSchema.parse(JSON.parse(readFileSync(join(dir, f), "utf8"))));
}

function cmdCreate(id: string): void {
  mkdirSync(instancesDir(), { recursive: true });
  mkdirSync(join(INSTANCE_ROOT, "data"), { recursive: true });
  const configPath = instanceConfigPath(id);
  if (existsSync(configPath)) {
    console.error(`updiscord: instance ${id} already exists at ${configPath}`);
    process.exit(1);
  }
  // Read existing configs without the personas>=1 gate: a fresh skeleton
  // legitimately has zero personas until a human fills it in.
  const existingRaw = existsSync(instancesDir())
    ? readdirSync(instancesDir())
        .filter((f) => f.endsWith(".json"))
        .map((f) => JSON.parse(readFileSync(join(instancesDir(), f), "utf8")) as InstanceConfig)
    : [];
  const skeleton = buildSkeletonConfig(id, existingRaw);
  writeFileSync(configPath, JSON.stringify(skeleton, null, 2));
  console.log(`Created ${configPath} (hubPort ${skeleton.hubPort}, adapterBasePort ${skeleton.adapterBasePort}).`);
  console.log(`Fill in guildId + personas, then create .env.${id} with ${skeleton.discordTokenEnv}.`);
}

/** Returns "started", "already-running", or "failed" — never throws/exits, so callers can batch. */
function startInstance(id: string): "started" | "already-running" | "failed" {
  const session = `${id}-hub`;
  if (tmux(["has-session", "-t", session]).status === 0) return "already-running";
  const result = tmux([
    "new-session", "-d", "-s", session, "-c", INSTANCE_ROOT,
    "--", "npx", "tsx", join(INSTANCE_ROOT, "bin", "hub-runner.ts"), "--instance", id,
  ]);
  if (result.status !== 0) {
    console.error(`updiscord: failed to start ${session}: ${result.stderr}`);
    return "failed";
  }
  return "started";
}

function cmdStart(id: string): void {
  const outcome = startInstance(id);
  if (outcome === "already-running") {
    console.error(`updiscord: ${id}-hub is already running`);
    process.exit(1);
  }
  if (outcome === "failed") process.exit(1);
  console.log(`Started ${id}-hub. Check status with: npm run cli -- list`);
}

/** Starts every configured instance that has at least one persona and isn't already running.
 *  Used by launchd at login/boot — must never exit non-zero just because one instance is already up. */
function cmdStartAll(): void {
  const configs = listInstanceConfigs().filter((cfg) => cfg.personas.length > 0);
  if (configs.length === 0) {
    console.log("updiscord: no instances with personas configured — nothing to start.");
    return;
  }
  let failed = false;
  for (const cfg of configs) {
    const outcome = startInstance(cfg.id);
    if (outcome === "failed") failed = true;
    console.log(`${cfg.id}: ${outcome}`);
  }
  if (failed) process.exit(1);
}

function cmdStop(id: string): void {
  const ls = tmux(["ls", "-F", "#{session_name}"]);
  const sessions =
    ls.status === 0 ? ls.stdout.split("\n").filter((s) => s === `${id}-hub` || s.startsWith(`${id}-`)) : [];
  for (const session of sessions) {
    tmux(["kill-session", "-t", session]);
    console.log(`Stopped ${session}`);
  }
  if (sessions.length === 0) console.log(`updiscord: no running sessions for ${id}`);
}

function cmdList(): void {
  const configs = listInstanceConfigs();
  if (configs.length === 0) {
    console.log("No instances registered.");
    return;
  }
  for (const cfg of configs) {
    const alive = tmux(["has-session", "-t", `${cfg.id}-hub`]).status === 0;
    const personas = cfg.personas.map((p) => p.name).join(",") || "(none configured)";
    console.log(`${cfg.id}\t${alive ? "running" : "stopped"}\thubPort=${cfg.hubPort}\tpersonas=${personas}`);
  }
}

function cmdLogs(id: string): void {
  const result = tmux(["capture-pane", "-t", `${id}-hub`, "-p"]);
  if (result.status !== 0) {
    console.error(`updiscord: no running session ${id}-hub`);
    process.exit(1);
  }
  console.log(result.stdout);
}

const [, , cmd, id] = process.argv;
switch (cmd) {
  case "create": cmdCreate(requireId(id)); break;
  case "start": cmdStart(requireId(id)); break;
  case "start-all": cmdStartAll(); break;
  case "stop": cmdStop(requireId(id)); break;
  case "list": cmdList(); break;
  case "logs": cmdLogs(requireId(id)); break;
  default:
    console.error("usage: npm run cli -- <create|start|start-all|stop|list|logs> [id]");
    process.exit(1);
}
