/**
 * Per-channel debounce buffer: rapid-fire messages collapse into one
 * delivery so the agent gets a batch instead of a turn per message.
 */

export interface BufferedMessage {
  channelId: string;
  channelName: string;
  author: string;
  content: string;
  messageId: string;
}

const WINDOW_MS = 5_000;
const MAX_WAIT_MS = 10_000;

interface Buffer {
  messages: BufferedMessage[];
  timer: NodeJS.Timeout;
  firstAt: number;
}

export class DebounceBuffer {
  private buffers = new Map<string, Buffer>();

  constructor(
    private readonly deliver: (channelId: string, messages: BufferedMessage[]) => void,
    private readonly windowMs = WINDOW_MS,
    private readonly maxWaitMs = MAX_WAIT_MS,
  ) {}

  push(msg: BufferedMessage) {
    const existing = this.buffers.get(msg.channelId);
    if (!existing) {
      const buf: Buffer = {
        messages: [msg],
        firstAt: Date.now(),
        timer: setTimeout(() => this.flush(msg.channelId), this.windowMs),
      };
      this.buffers.set(msg.channelId, buf);
      return;
    }
    existing.messages.push(msg);
    clearTimeout(existing.timer);
    const elapsed = Date.now() - existing.firstAt;
    const wait = Math.min(this.windowMs, Math.max(0, this.maxWaitMs - elapsed));
    existing.timer = setTimeout(() => this.flush(msg.channelId), wait);
  }

  private flush(channelId: string) {
    const buf = this.buffers.get(channelId);
    if (!buf) return;
    this.buffers.delete(channelId);
    this.deliver(channelId, buf.messages);
  }
}
