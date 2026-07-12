/**
 * Message splitting for Discord's 2000-char limit. Ported from
 * disco-factory: prefers paragraph > line > space > force split points and
 * keeps markdown code fences balanced across chunks.
 */

const SPLIT_TARGET_LENGTH = 1900; // 100-char buffer under Discord's 2000 limit

/** Find the best split point within maxLength. Prefers paragraph > line > space > force. */
function findSplitPoint(text: string, maxLength: number): number {
  if (text.length <= maxLength) return text.length;

  const paraIdx = text.lastIndexOf("\n\n", maxLength);
  if (paraIdx > 0) return paraIdx + 2;

  const lineIdx = text.lastIndexOf("\n", maxLength);
  if (lineIdx > 0) return lineIdx + 1;

  const spaceIdx = text.lastIndexOf(" ", maxLength);
  if (spaceIdx > 0) return spaceIdx + 1;

  return maxLength;
}

/** Track whether text ends inside an open code fence. Returns the opening fence if so. */
function trackFences(
  text: string,
  currentFence: string | null,
): { isOpen: boolean; fence: string } {
  let isOpen = currentFence !== null;
  let fence = currentFence || "```";

  for (const line of text.split("\n")) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith("```")) {
      if (isOpen) {
        isOpen = false;
      } else {
        isOpen = true;
        fence = trimmed.match(/^(`{3,}\S*)/)?.[1] || "```";
      }
    }
  }

  return { isOpen, fence };
}

/** Split a message into chunks that fit within Discord's character limit. */
export function splitMessage(content: string, maxLength = SPLIT_TARGET_LENGTH): string[] {
  if (content.length <= maxLength) return [content];

  const chunks: string[] = [];
  let remaining = content;
  let openFence: string | null = null;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    const splitAt = findSplitPoint(remaining, maxLength);
    let chunk = remaining.slice(0, splitAt);
    remaining = remaining.slice(splitAt);

    const fenceState = trackFences(chunk, openFence);

    if (fenceState.isOpen) {
      chunk += "\n```";
      remaining = fenceState.fence + "\n" + remaining;
      openFence = fenceState.fence;
    } else {
      openFence = null;
    }

    const trimmed = chunk.trim();
    if (trimmed.length > 0) chunks.push(trimmed);
  }

  return chunks;
}
