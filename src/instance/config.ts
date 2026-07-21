import { z } from "zod";

export const PersonaConfigSchema = z.object({
  name: z.string().min(1),
  kind: z.string().min(1),
  channelId: z.string().min(1),
  cwd: z.string().min(1),
  adapterCommand: z.object({ command: z.string().min(1), args: z.array(z.string()) }),
  adapterEnv: z.record(z.string()).optional(),
  claudeAgent: z.string().optional(),
  model: z.string().optional(),
  onboardingMessage: z.string().optional(),
  onReadyHook: z.string().optional(),
  extraMcpServers: z.record(z.unknown()).optional(),
});

export const InstanceConfigSchema = z.object({
  id: z.string().min(1),
  discordTokenEnv: z.string().min(1),
  guildId: z.string().min(1),
  hubPort: z.number().int().positive(),
  adapterBasePort: z.number().int().positive(),
  personas: z.array(PersonaConfigSchema),
});

export type PersonaConfig = z.infer<typeof PersonaConfigSchema>;
export type InstanceConfig = z.infer<typeof InstanceConfigSchema>;

export function parseInstanceConfig(raw: unknown): InstanceConfig {
  const config = InstanceConfigSchema.parse(raw);
  if (config.personas.length === 0) {
    throw new Error(`updiscord: instance ${config.id} has no personas configured`);
  }
  return config;
}

const PORT_BLOCK = 100;
const BASE_HUB_PORT = 4400;
const ADAPTER_OFFSET = 100;

export function allocatePorts(existing: InstanceConfig[]): { hubPort: number; adapterBasePort: number } {
  const maxHubPort = existing.reduce((max, cfg) => Math.max(max, cfg.hubPort), BASE_HUB_PORT - PORT_BLOCK);
  const hubPort = maxHubPort + PORT_BLOCK;
  return { hubPort, adapterBasePort: hubPort + ADAPTER_OFFSET };
}

export function buildSkeletonConfig(id: string, existing: InstanceConfig[]): InstanceConfig {
  const { hubPort, adapterBasePort } = allocatePorts(existing);
  return {
    id,
    discordTokenEnv: `${id.toUpperCase().replace(/-/g, "_")}_DISCORD_TOKEN`,
    guildId: "REPLACE_ME",
    hubPort,
    adapterBasePort,
    personas: [],
  };
}
