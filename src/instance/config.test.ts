import { describe, expect, test } from "vitest";
import { allocatePorts, buildSkeletonConfig, parseInstanceConfig } from "./config";

const validRaw = {
  id: "lacimarsik",
  discordTokenEnv: "LACIMARSIK_DISCORD_TOKEN",
  guildId: "g1",
  hubPort: 4400,
  adapterBasePort: 4500,
  personas: [
    {
      name: "WalletUpAdvisor",
      kind: "advisor",
      channelId: "c1",
      cwd: "/repo/walletup",
      adapterCommand: { command: "tsx", args: ["adapter.ts"] },
    },
  ],
};

describe("parseInstanceConfig", () => {
  test("accepts a minimal valid config", () => {
    expect(parseInstanceConfig(validRaw)).toMatchObject({ id: "lacimarsik" });
  });

  test("rejects a config with no personas", () => {
    expect(() => parseInstanceConfig({ ...validRaw, personas: [] })).toThrow();
  });

  test("rejects a persona missing adapterCommand", () => {
    const bad = { ...validRaw, personas: [{ name: "P", kind: "k", channelId: "c", cwd: "/x" }] };
    expect(() => parseInstanceConfig(bad)).toThrow();
  });
});

describe("allocatePorts", () => {
  test("starts at the base block when no instances exist", () => {
    expect(allocatePorts([])).toEqual({ hubPort: 4400, adapterBasePort: 4500 });
  });

  test("picks the next free block after the highest existing hubPort", () => {
    const existing = [parseInstanceConfig(validRaw)];
    expect(allocatePorts(existing)).toEqual({ hubPort: 4600, adapterBasePort: 4700 });
  });

  test("an instance's adapter port range never reaches the next instance's hubPort", () => {
    // Regression: PORT_BLOCK must stay wider than ADAPTER_OFFSET, or a
    // second instance's hubPort collides with the first instance's
    // adapterBasePort (observed live: both landed on 4500).
    const first = allocatePorts([]);
    const second = allocatePorts([{ ...validRaw, ...first }]);
    expect(second.hubPort).toBeGreaterThan(first.adapterBasePort);
  });
});

describe("buildSkeletonConfig", () => {
  test("derives a SCREAMING_SNAKE token env name from a kebab id", () => {
    const cfg = buildSkeletonConfig("walletup-lacimarsik", []);
    expect(cfg.discordTokenEnv).toBe("WALLETUP_LACIMARSIK_DISCORD_TOKEN");
    expect(cfg.hubPort).toBe(4400);
    expect(cfg.personas).toEqual([]);
  });

  test("allocates the next port block when other instances already exist", () => {
    const existing = [parseInstanceConfig(validRaw)];
    const cfg = buildSkeletonConfig("upwithagents", existing);
    expect(cfg.hubPort).toBe(4600);
  });
});
