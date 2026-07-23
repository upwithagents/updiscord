import { join } from "node:path";

export const INSTANCE_ROOT = join(import.meta.dirname, "..", "..");

export function instancesDir(root: string = INSTANCE_ROOT): string {
  return join(root, "instances");
}

export function instanceConfigPath(id: string, root: string = INSTANCE_ROOT): string {
  return join(instancesDir(root), `${id}.json`);
}

export function instanceDbPath(id: string, root: string = INSTANCE_ROOT): string {
  return join(root, "data", `${id}.db`);
}

export function instanceEnvPath(id: string, root: string = INSTANCE_ROOT): string {
  return join(root, `.env.${id}`);
}

export function instanceMcpConfigDir(id: string, root: string = INSTANCE_ROOT): string {
  return join(root, ".mcp-config", id);
}
