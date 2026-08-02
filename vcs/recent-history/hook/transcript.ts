import { readFileSync } from "node:fs";

interface UserEntry {
  type: "user";
  uuid: string;
  parentUuid: string | null;
  promptId?: string;
}

interface AssistantEntry {
  type: "assistant";
  uuid: string;
  parentUuid: string | null;
  message?: { content?: Array<{ type?: string; id?: string }> };
}

interface LastPromptEntry {
  type: "last-prompt";
  leafUuid: string;
}

type Entry = UserEntry | AssistantEntry | LastPromptEntry | { type: string };

function harvestIds(entry: Entry): string[] {
  const ids: string[] = [];
  if (entry.type === "user") {
    const promptId = (entry as UserEntry).promptId;
    if (typeof promptId === "string") ids.push(promptId);
  } else if (entry.type === "assistant") {
    const content = (entry as AssistantEntry).message?.content ?? [];
    for (const block of content) {
      if (block?.type === "tool_use" && typeof block.id === "string") {
        ids.push(block.id);
      }
    }
  }
  return ids;
}

/**
 * Walks the transcript backward from the current active leaf, harvests
 * promptIds and tool_use ids from each ancestor, and returns the first
 * matching index entry's timestamp.
 *
 * No exclusion of "the current fire's id" is needed: the caller writes to the
 * index AFTER this function returns, so no entry from the current fire can
 * appear in the index at read time. A raw id that coincides with the current
 * fire's id (e.g., PreToolUse and PostToolUse sharing a tool_use_id) is the
 * legitimate case we want to hit — that's the previous fire's write we're
 * looking for.
 */
export function findPreviousFireTimestamp(opts: {
  transcriptPath: string;
  index: Map<string, string>;
}): string | null {
  // Fresh sessions fire UserPromptSubmit before Claude Code writes the
  // transcript; treat that as "no previous fire" rather than crashing.
  let text: string;
  try {
    text = readFileSync(opts.transcriptPath, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
  const lines = text.split("\n");
  // First pass: reverse-scan for the latest last-prompt entry.
  let targetUuid: string | null = null;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!;
    if (!line || !line.includes('"type":"last-prompt"')) continue;
    const parsed = JSON.parse(line) as LastPromptEntry;
    targetUuid = parsed.leafUuid;
    break;
  }
  if (targetUuid === null) return null;
  // Second pass: walk the parent chain, harvesting ids.
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!;
    if (!line) continue;
    if (!line.includes(`"uuid":"${targetUuid}"`)) continue;
    const parsed = JSON.parse(line) as Entry;
    for (const id of harvestIds(parsed)) {
      const hit = opts.index.get(id);
      if (hit !== undefined) return hit;
    }
    const parent = (parsed as UserEntry | AssistantEntry).parentUuid ?? null;
    if (parent === null) return null;
    targetUuid = parent;
    // Restart scan from the tail — cheap in practice; refined later if needed.
    i = lines.length;
  }
  return null;
}
