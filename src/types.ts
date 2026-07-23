import type { Client } from "discord.js";

export type AgentStatus = "offline" | "starting" | "ready" | "running" | "dead";

/** A registered agent persona (one row in the store's agent registry). */
export interface AgentRecord {
  id: string;
  name: string;
  kind: string; // host-defined, e.g. "advisor"
  channelId: string;
  webhookId: string | null;
  webhookToken: string | null;
  tmuxSession: string | null;
  adapterPort: number | null;
  status: AgentStatus;
  /** Receives inbound messages from every channel in the guild, not just channelId. */
  listensGuildWide: boolean;
}

export type MessageDirection = "inbound" | "outbound";

/** One audit-log entry. `createdAt` is an ISO-8601 string (sortable). */
export interface MessageRecord {
  id: number;
  discordId: string | null;
  channelId: string;
  direction: MessageDirection;
  authorName: string;
  agentId: string | null;
  content: string;
  createdAt: string;
}

export interface NewMessage {
  discordId?: string;
  channelId: string;
  direction: MessageDirection;
  authorName: string;
  agentId?: string;
  content: string;
}

/**
 * Storage seam. The library ships SqliteHubStore; hosts that want the audit
 * log in their own DB (e.g. walletup's Prisma) implement this instead.
 */
export interface HubStore {
  /** Create the agent if missing; sync kind/channelId/adapterPort/listensGuildWide to the given values. */
  ensureAgent(input: {
    name: string;
    kind: string;
    channelId: string;
    adapterPort: number;
    listensGuildWide?: boolean;
  }): Promise<AgentRecord>;
  getAgent(id: string): Promise<AgentRecord | null>;
  getAgentByName(name: string): Promise<AgentRecord | null>;
  listAgents(): Promise<AgentRecord[]>;
  updateAgent(
    id: string,
    patch: Partial<Omit<AgentRecord, "id" | "name">>,
  ): Promise<void>;
  logMessage(msg: NewMessage): Promise<void>;
  /** Newest-first. */
  channelHistory(channelId: string, limit: number): Promise<MessageRecord[]>;
  /** Inbound messages in a channel with id > afterId (all if null), oldest-first. */
  inboundSince(
    channelId: string,
    afterId: number | null,
    limit: number,
  ): Promise<MessageRecord[]>;
  /** Audit-log id of the agent's most recent outbound message, or null. */
  lastOutboundId(agentId: string): Promise<number | null>;
  close(): Promise<void>;
}

export interface AgentConfig {
  name: string;
  kind: string;
  channelId: string;
  /** Sent to the agent (via its adapter) when it signals ready. Backlog is appended. */
  onboardingMessage?: string;
  /** Shell command exec'd (fire-and-forget) once, right after onboarding delivery. */
  onReadyHook?: string;
  /** Receives inbound messages from every channel in the guild, not just channelId. Default false. */
  listensGuildWide?: boolean;
}

/** A request from an existing persona to register and launch a new one. */
export interface SpawnPersonaInput {
  name: string;
  kind: string;
  channelId: string;
  cwd: string;
  adapterCommand: { command: string; args: string[] };
  adapterEnv?: Record<string, string>;
  claudeAgent?: string;
  model?: string;
  onboardingMessage?: string;
  listensGuildWide?: boolean;
}

export interface HubConfig {
  token: string;
  guildId: string;
  agents: AgentConfig[];
  /** Control API port. Default 4400. */
  httpPort?: number;
  /** Agent i gets adapter port base+i. Default 4500. */
  adapterBasePort?: number;
  /** Custom store; when omitted a SqliteHubStore at storePath is created. */
  store?: HubStore;
  /** Default "./updiscord.db". Only used when store is omitted. */
  storePath?: string;
  /** Webhook name prefix, default "updiscord" (webhooks named `<prefix>-<agent>`). */
  webhookPrefix?: string;
  /**
   * Called after a persona is registered via the spawn_persona tool, before
   * the HTTP response goes out. The host (bin/hub-runner.ts) uses this to
   * persist the new persona into instances/<id>.json and launch its tmux
   * session — startHub itself never touches the filesystem or tmux.
   */
  onPersonaSpawned?: (agent: AgentRecord, input: SpawnPersonaInput) => Promise<void>;
}

export interface Hub {
  client: Client;
  store: HubStore;
  agents: AgentRecord[];
  sendAsAgent(agentName: string, channelId: string, content: string): Promise<void>;
  stop(): Promise<void>;
}
