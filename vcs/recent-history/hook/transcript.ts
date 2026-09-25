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
 * Reads the transcript and returns the `promptId` of the latest `user` entry,
 * or null if none can be resolved. `claude -p` doesn't include `prompt_id` in
 * the UserPromptSubmit hook payload, so the hook falls back to this to keep the
 * index keyed by the same id the walker will later harvest.
 */
export function currentPromptIdFromTranscript(
  transcriptPath: string,
): string | null {
  let text: string;
  try {
    text = readFileSync(transcriptPath, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!;
    if (!line || !line.includes('"type":"user"')) continue;
    const parsed = JSON.parse(line) as { type?: string; promptId?: string };
    if (parsed.type === "user" && typeof parsed.promptId === "string") {
      return parsed.promptId;
    }
  }
  return null;
}

/**
 * Walks the transcript backward, harvests promptIds and tool_use ids from each
 * user/assistant entry, and returns the first matching index entry's
 * timestamp.
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
  // Reverse-scan every user/assistant entry, harvest ids, return the first
  // index hit. This intentionally does NOT follow the `last-prompt` anchor:
  // in `claude -p`, `last-prompt` can lag behind the physical tail (e.g. it
  // still points at a pre-tool-use leaf while PostToolUse fires), which
  // would cut the walker off before the assistant entry containing the
  // current tool_use id.
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!;
    if (!line) continue;
    if (!line.includes('"type":"user"') && !line.includes('"type":"assistant"'))
      continue;
    let parsed: Entry;
    try {
      parsed = JSON.parse(line) as Entry;
    } catch {
      continue;
    }
    for (const id of harvestIds(parsed)) {
      const hit = opts.index.get(id);
      if (hit !== undefined) return hit;
    }
  }
  return null;
}
