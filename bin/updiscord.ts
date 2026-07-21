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

function cmdStart(id: string): void {
  const session = `${id}-hub`;
  if (tmux(["has-session", "-t", session]).status === 0) {
    console.error(`updiscord: ${session} is already running`);
    process.exit(1);
  }
  const result = tmux([
    "new-session", "-d", "-s", session, "-c", INSTANCE_ROOT,
    "--", "npx", "tsx", join(INSTANCE_ROOT, "bin", "hub-runner.ts"), "--instance", id,
  ]);
  if (result.status !== 0) {
    console.error(`updiscord: failed to start ${session}: ${result.stderr}`);
    process.exit(1);
  }
  console.log(`Started ${session}. Check status with: npm run cli -- list`);
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
  case "stop": cmdStop(requireId(id)); break;
  case "list": cmdList(); break;
  case "logs": cmdLogs(requireId(id)); break;
  default:
    console.error("usage: npm run cli -- <create|start|stop|list|logs> [id]");
    process.exit(1);
}
