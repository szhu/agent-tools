import { join } from "@std/path";
import {
  appendFile,
  mkdir,
  readdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import type {
  ConversationDetail,
  ConversationSummary,
  ProjectSummary,
} from "./api.ts";
import {
  conversationFilename,
  projectListCacheFilename,
  toMarkdown,
} from "./markdown.ts";

// Conversation files use the same Markdown format printed to stdout, so the
// cache dir is a browsable export directory, not an opaque internal store.

export interface CachedConversation {
  path: string;
  fetchedAt: Date;
}

/**
 * Locates a cached conversation by id via its filename prefix (see
 * conversationFilename) instead of opening every file to check its
 * frontmatter.
 */
export async function findCachedConversation(
  cacheDir: string,
  id: string,
): Promise<CachedConversation | null> {
  const idPrefix = id.slice(0, 8);
  let entries: string[];
  try {
    entries = await readdir(cacheDir);
  } catch {
    return null;
  }
  const match = entries.find(
    (name) => name.endsWith(".md") && name.includes(idPrefix),
  );
  if (!match) return null;
  const path = join(cacheDir, match);
  const content = await readFile(path, "utf-8");
  const fetchedAtMatch = content.match(/^fetched_at: (.+)$/m);
  if (!fetchedAtMatch || !fetchedAtMatch[1]) return null;
  return { path, fetchedAt: new Date(fetchedAtMatch[1]) };
}

export async function readCachedConversation(path: string): Promise<string> {
  return readFile(path, "utf-8");
}

export async function writeCachedConversation(
  cacheDir: string,
  id: string,
  detail: ConversationDetail,
  fetchedAt: Date,
): Promise<string> {
  await mkdir(cacheDir, { recursive: true });
  const markdown = toMarkdown(id, detail, fetchedAt);
  const filename = conversationFilename(id, detail.create_time, detail.title);
  const path = join(cacheDir, filename);
  await writeFile(path, markdown);
  return markdown;
}

export function isFresh(fetchedAt: Date, maxAgeMs: number): boolean {
  return Date.now() - fetchedAt.getTime() < maxAgeMs;
}

// The list cache is an append-only JSONL log, one line per (conversation,
// fetch) observation. Rows are never rewritten in place, so a crash mid-write
// only risks the last, possibly-truncated line. Reading means keeping only
// the last line per id (last-write-wins).

export interface ListCacheEntry {
  id: string;
  title: string;
  update_time: string;
  fetched_at: string;
  // Verified neighbors (by update_time order) actually observed adjacent to
  // this entry in the fetch that produced it — null means "no confirmed
  // neighbor in that direction," either because this entry was at the very
  // top/bottom of everything, or because the page's edge fell here and no
  // fetch has yet walked far enough to confirm what comes next.
  prev_update_time: string | null;
  next_update_time: string | null;
}

const DEFAULT_LIST_CACHE_FILENAME = "default.jsonl";

/**
 * Each project (and the no-project default) is its own independent
 * update_time-ordered sequence with its own gaps, so each gets its own file
 * under projects/ rather than one shared log across all of them.
 */
export function listCachePath(cacheDir: string, filename?: string): string {
  return join(cacheDir, "projects", filename ?? DEFAULT_LIST_CACHE_FILENAME);
}

/**
 * Reads all entries and keeps only the last line per id (last-write-wins),
 * materializing the flat map from the append-only log.
 */
export async function readListCache(
  cacheDir: string,
  filename?: string,
): Promise<Map<string, ListCacheEntry>> {
  const map = new Map<string, ListCacheEntry>();
  let text: string;
  try {
    text = await readFile(listCachePath(cacheDir, filename), "utf-8");
  } catch {
    return map;
  }
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let entry: ListCacheEntry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue; // Skip a truncated final line from an interrupted write.
    }
    map.set(entry.id, entry);
  }
  return map;
}

/**
 * Merges one fetched page into the list cache: appends a new-or-updated entry
 * per item, with prev/next set from what was actually adjacent in this page
 * (not from the pre-existing cache, which may be stale or disagree with what
 * this fetch just observed).
 */
export async function appendListCachePage(
  cacheDir: string,
  items: ConversationSummary[],
  fetchedAt: Date,
  filename?: string,
): Promise<void> {
  if (items.length === 0) return;
  const path = listCachePath(cacheDir, filename);
  await mkdir(join(cacheDir, "projects"), { recursive: true });
  const fetchedAtIso = fetchedAt.toISOString();
  const lines = items.map((item, i) => {
    const entry: ListCacheEntry = {
      id: item.id,
      title: item.title,
      update_time: item.update_time,
      fetched_at: fetchedAtIso,
      prev_update_time: i > 0 ? items[i - 1]!.update_time : null,
      next_update_time: i < items.length - 1 ? items[i + 1]!.update_time : null,
    };
    return JSON.stringify(entry);
  });
  await appendFile(path, lines.join("\n") + "\n");
}

/**
 * Two entries that are adjacent by update_time in the current merged map are
 * only _verified_ contiguous if some single fetch actually observed them next
 * to each other — i.e. one's next_update_time matches the other's update_time.
 * Without that match, something could exist between them that no fetch has ever
 * seen (a gap), even though sorting makes them look adjacent today.
 */
export function isVerifiedAdjacent(
  newer: ListCacheEntry,
  older: ListCacheEntry,
): boolean {
  return (
    newer.next_update_time === older.update_time ||
    older.prev_update_time === newer.update_time
  );
}

// The project index maps a project id to the list-cache filename computed
// for it (see projectListCacheFilename) — computing that filename requires
// the project's title and create_time, which only list-projects fetches.
// list-conversations --project reads this instead of re-fetching that
// metadata, so a project's list cache always lands at one consistent path.

const PROJECT_INDEX_FILENAME = "index.jsonl";

interface ProjectIndexEntry {
  id: string;
  filename: string;
}

function projectIndexPath(cacheDir: string): string {
  return join(cacheDir, "projects", PROJECT_INDEX_FILENAME);
}

export async function readProjectIndex(
  cacheDir: string,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  let text: string;
  try {
    text = await readFile(projectIndexPath(cacheDir), "utf-8");
  } catch {
    return map;
  }
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let entry: ProjectIndexEntry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    map.set(entry.id, entry.filename);
  }
  return map;
}

export async function appendProjectIndex(
  cacheDir: string,
  projects: ProjectSummary[],
): Promise<void> {
  if (projects.length === 0) return;
  await mkdir(join(cacheDir, "projects"), { recursive: true });
  const lines = projects.map((project) => {
    const entry: ProjectIndexEntry = {
      id: project.id,
      filename: projectListCacheFilename(
        project.id,
        project.create_time,
        project.title,
      ),
    };
    return JSON.stringify(entry);
  });
  await appendFile(projectIndexPath(cacheDir), lines.join("\n") + "\n");
}
