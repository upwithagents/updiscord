/**
 * Generic executable adapter — for personas that don't need app-specific
 * MCP tools (reply/read_channel from updiscord/adapter is enough). Point
 * a persona's adapterCommand at this file directly rather than writing a
 * one-line wrapper per app.
 */

import { runAdapter } from "../src/adapter";

await runAdapter();
