/**
 * Default HubStore: better-sqlite3 with hand-written migrations
 * (disco-factory style). Synchronous under the hood; async interface so
 * host-provided stores (e.g. Prisma-backed) can be swapped in.
 */

import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type {
  AgentRecord,
  AgentStatus,
  HubStore,
  MessageRecord,
  NewMessage,
} from "../types";

const MIGRATIONS: string[] = [
  `
  CREATE TABLE agents (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL UNIQUE,
    kind          TEXT NOT NULL,
    channel_id    TEXT NOT NULL,
    webhook_id    TEXT,
    webhook_token TEXT,
    tmux_session  TEXT,
    adapter_port  INTEGER,
    status        TEXT NOT NULL DEFAULT 'offline',
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE TABLE messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_id  TEXT UNIQUE,
    channel_id  TEXT NOT NULL,
    direction   TEXT NOT NULL CHECK (direction IN ('inbound','outbound')),
    author_name TEXT NOT NULL,
    agent_id    TEXT REFERENCES agents(id),
    content     TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE INDEX idx_messages_channel_id ON messages(channel_id, id);
  `,
  `
  ALTER TABLE agents ADD COLUMN listens_guild_wide INTEGER NOT NULL DEFAULT 0;
  `,
];

interface AgentRow {
  id: string;
  name: string;
  kind: string;
  channel_id: string;
  webhook_id: string | null;
  webhook_token: string | null;
  tmux_session: string | null;
  adapter_port: number | null;
  status: string;
  listens_guild_wide: number;
}

interface MessageRow {
  id: number;
  discord_id: string | null;
  channel_id: string;
  direction: string;
  author_name: string;
  agent_id: string | null;
  content: string;
  created_at: string;
}

function rowToAgent(row: AgentRow): AgentRecord {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    channelId: row.channel_id,
    webhookId: row.webhook_id,
    webhookToken: row.webhook_token,
    tmuxSession: row.tmux_session,
    adapterPort: row.adapter_port,
    status: row.status as AgentStatus,
    listensGuildWide: row.listens_guild_wide === 1,
  };
}

function rowToMessage(row: MessageRow): MessageRecord {
  return {
    id: row.id,
    discordId: row.discord_id,
    channelId: row.channel_id,
    direction: row.direction as MessageRecord["direction"],
    authorName: row.author_name,
    agentId: row.agent_id,
    content: row.content,
    createdAt: row.created_at,
  };
}

function migrate(db: Database.Database): void {
  const current = db.pragma("user_version", { simple: true }) as number;
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.exec("BEGIN");
    try {
      db.exec(MIGRATIONS[v]);
      db.pragma(`user_version = ${v + 1}`);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
}

const AGENT_COLUMNS: Record<string, string> = {
  kind: "kind",
  channelId: "channel_id",
  webhookId: "webhook_id",
  webhookToken: "webhook_token",
  tmuxSession: "tmux_session",
  adapterPort: "adapter_port",
  status: "status",
  listensGuildWide: "listens_guild_wide",
};

/** better-sqlite3 can't bind native booleans; agents' only boolean column needs 0/1. */
function bindableAgentValue(key: string, value: unknown): unknown {
  return key === "listensGuildWide" ? (value ? 1 : 0) : value;
}

export class SqliteHubStore implements HubStore {
  private db: Database.Database;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    migrate(this.db);
  }

  async ensureAgent(input: {
    name: string;
    kind: string;
    channelId: string;
    adapterPort: number;
    listensGuildWide?: boolean;
  }): Promise<AgentRecord> {
    const listensGuildWide = input.listensGuildWide ?? false;
    const existing = this.db
      .prepare("SELECT * FROM agents WHERE name = ?")
      .get(input.name) as AgentRow | undefined;
    if (existing) {
      this.db
        .prepare(
          `UPDATE agents SET kind = ?, channel_id = ?, adapter_port = ?, listens_guild_wide = ?,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
        )
        .run(input.kind, input.channelId, input.adapterPort, listensGuildWide ? 1 : 0, existing.id);
      return (await this.getAgent(existing.id))!;
    }
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO agents (id, name, kind, channel_id, adapter_port, listens_guild_wide)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, input.name, input.kind, input.channelId, input.adapterPort, listensGuildWide ? 1 : 0);
    return (await this.getAgent(id))!;
  }

  async getAgent(id: string): Promise<AgentRecord | null> {
    const row = this.db.prepare("SELECT * FROM agents WHERE id = ?").get(id) as
      | AgentRow
      | undefined;
    return row ? rowToAgent(row) : null;
  }

  async getAgentByName(name: string): Promise<AgentRecord | null> {
    const row = this.db.prepare("SELECT * FROM agents WHERE name = ?").get(name) as
      | AgentRow
      | undefined;
    return row ? rowToAgent(row) : null;
  }

  async listAgents(): Promise<AgentRecord[]> {
    const rows = this.db.prepare("SELECT * FROM agents ORDER BY name").all() as AgentRow[];
    return rows.map(rowToAgent);
  }

  async updateAgent(
    id: string,
    patch: Partial<Omit<AgentRecord, "id" | "name">>,
  ): Promise<void> {
    const sets: string[] = [];
    const values: unknown[] = [];
    for (const [key, column] of Object.entries(AGENT_COLUMNS)) {
      if (key in patch) {
        sets.push(`${column} = ?`);
        values.push(bindableAgentValue(key, (patch as Record<string, unknown>)[key]));
      }
    }
    if (sets.length === 0) return;
    sets.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')");
    this.db.prepare(`UPDATE agents SET ${sets.join(", ")} WHERE id = ?`).run(...values, id);
  }

  async logMessage(msg: NewMessage): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO messages (discord_id, channel_id, direction, author_name, agent_id, content)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        msg.discordId ?? null,
        msg.channelId,
        msg.direction,
        msg.authorName,
        msg.agentId ?? null,
        msg.content,
      );
  }

  async channelHistory(channelId: string, limit: number): Promise<MessageRecord[]> {
    const rows = this.db
      .prepare("SELECT * FROM messages WHERE channel_id = ? ORDER BY id DESC LIMIT ?")
      .all(channelId, limit) as MessageRow[];
    return rows.map(rowToMessage);
  }

  async inboundSince(
    channelId: string,
    afterId: number | null,
    limit: number,
  ): Promise<MessageRecord[]> {
    const rows = this.db
      .prepare(
        `SELECT * FROM messages
         WHERE channel_id = ? AND direction = 'inbound' AND id > ?
         ORDER BY id ASC LIMIT ?`,
      )
      .all(channelId, afterId ?? 0, limit) as MessageRow[];
    return rows.map(rowToMessage);
  }

  async lastOutboundId(agentId: string): Promise<number | null> {
    const row = this.db
      .prepare(
        "SELECT id FROM messages WHERE agent_id = ? AND direction = 'outbound' ORDER BY id DESC LIMIT 1",
      )
      .get(agentId) as { id: number } | undefined;
    return row?.id ?? null;
  }

  async close(): Promise<void> {
    this.db.close();
  }
}
