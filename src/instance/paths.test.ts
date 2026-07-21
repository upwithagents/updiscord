import { describe, expect, test } from "vitest";
import {
  instanceConfigPath,
  instanceDbPath,
  instanceEnvPath,
  instanceMcpConfigDir,
  instancesDir,
} from "./paths";

describe("instance paths", () => {
  test("builds config/db/env/mcp paths under the given root", () => {
    expect(instanceConfigPath("lacimarsik", "/root")).toBe("/root/instances/lacimarsik.json");
    expect(instanceDbPath("lacimarsik", "/root")).toBe("/root/data/lacimarsik.db");
    expect(instanceEnvPath("lacimarsik", "/root")).toBe("/root/.env.lacimarsik");
    expect(instanceMcpConfigDir("lacimarsik", "/root")).toBe("/root/.mcp-config/lacimarsik");
    expect(instancesDir("/root")).toBe("/root/instances");
  });
});
