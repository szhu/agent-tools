import { ArgsParser, args, exit } from "@cross/utils";
import { resolve } from "@std/path";
import type { ConversationSummary } from "./api.ts";
import {
  fetchConversationDetail,
  fetchConversationsPage,
  fetchProjectConversationsPage,
  fetchProjectsPage,
} from "./api.ts";
import { loadCredentials, runLogin } from "./auth.ts";
import {
  appendListCachePage,
  appendProjectIndex,
  findCachedConversation,
  isFresh,
  isVerifiedAdjacent,
  readCachedConversation,
  readListCache,
  readProjectIndex,
  writeCachedConversation,
} from "./cache.ts";
import { toMarkdown } from "./markdown.ts";

export function parseDurationMs(input: string): number {
  if (input === "0") return 0; // bare 0 means "never fresh", no unit needed
  const match = input.match(/^(\d+)(ms|s|m|h|d)$/);
  if (!match || !match[1] || !match[2]) {
    throw new Error(
      `Invalid duration '${input}'. Use a number followed by ms, s, m, h, or d (e.g. 24h), or 0.`,
    );
  }
  const value = Number(match[1]);
  const unitMs = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[
    match[2]
  ]!;
  return value * unitMs;
}

interface CacheOptions {
  cacheDir: string | undefined;
  cacheMaxAgeMs: number | undefined;
}

function resolveCacheOptions(parsed: ArgsParser): CacheOptions {
  const cacheDirFlag = parsed.get("cache-dir") as string | undefined;
  const cacheDir = cacheDirFlag ?? process.env["CHATGPT_ACCESS_CACHE_DIR"];
  const cacheMaxAgeRaw =
    (parsed.get("cache-max-age") as string | undefined) ??
    process.env["CHATGPT_ACCESS_CACHE_MAX_AGE"];
  if (cacheMaxAgeRaw !== undefined && !cacheDir) {
    throw new Error(
      "--cache-max-age (or CHATGPT_ACCESS_CACHE_MAX_AGE) requires --cache-dir (or CHATGPT_ACCESS_CACHE_DIR) to also be set.",
    );
  }
  if (cacheDir) {
    const source = cacheDirFlag !== undefined ? "--cache-dir" : "$CHATGPT_ACCESS_CACHE_DIR";
    console.error(`using cache dir: ${resolve(cacheDir)} (from ${source})`);
  }
  return {
    cacheDir,
    cacheMaxAgeMs:
      cacheMaxAgeRaw !== undefined
        ? parseDurationMs(cacheMaxAgeRaw)
        : undefined,
  };
}

async function runGetConversation(
  id: string,
  { cacheDir, cacheMaxAgeMs }: CacheOptions,
): Promise<void> {
  if (cacheDir) {
    const cached = await findCachedConversation(cacheDir, id);
    if (
      cached &&
      cacheMaxAgeMs !== undefined &&
      isFresh(cached.fetchedAt, cacheMaxAgeMs)
    ) {
      console.error(
        `cache hit: ${id} (fetched ${cached.fetchedAt.toISOString()})`,
      );
      process.stdout.write(await readCachedConversation(cached.path));
      return;
    }
    console.error(
      cached ? `cache stale: ${id}, refetching` : `cache miss: ${id}, fetching`,
    );
  }

  const creds = loadCredentials();
  if (!creds) throw new Error("No saved credentials. Run 'login' first.");
  const detail = await fetchConversationDetail(id, creds);
  const fetchedAt = new Date();

  if (cacheDir) {
    const markdown = await writeCachedConversation(
      cacheDir,
      id,
      detail,
      fetchedAt,
    );
    process.stdout.write(markdown);
  } else {
    process.stdout.write(toMarkdown(id, detail, fetchedAt));
  }
}

function printConversationSummaries(
  items: { update_time: string; id: string; title: string }[],
) {
  for (const item of items) {
    // update_time first, then id, so each NDJSON line sorts chronologically
    // as plain text (via `sort`) and reads left-aligned by eye.
    console.log(
      JSON.stringify({
        update_time: item.update_time,
        id: item.id,
        title: item.title,
      }),
    );
  }
}

async function cacheConversationPage(
  cacheDir: string,
  items: ConversationSummary[],
  filename: string | undefined,
  label: string,
): Promise<void> {
  const fetchedAt = new Date();
  const before = await readListCache(cacheDir, filename);
  await appendListCachePage(cacheDir, items, fetchedAt, filename);
  let gaps = 0;
  for (let i = 0; i < items.length - 1; i++) {
    const newer = before.get(items[i]!.id);
    const older = before.get(items[i + 1]!.id);
    if (newer && older && !isVerifiedAdjacent(newer, older)) gaps++;
  }
  console.error(`cached ${items.length} row(s) to ${label}`);
  if (gaps > 0) {
    console.error(
      `warning: ${gaps} previously-cached adjacency(s) in this range are unverified — a fetch may have skipped over them`,
    );
  }
}

interface ListConversationsArgs {
  offset: number | undefined;
  limit: number | undefined;
  cursor: string | undefined;
  project: string | undefined;
}

async function runListConversations(
  { offset, limit, cursor, project }: ListConversationsArgs,
  { cacheDir }: CacheOptions,
): Promise<void> {
  const creds = loadCredentials();
  if (!creds) throw new Error("No saved credentials. Run 'login' first.");

  if (project) {
    if (offset !== undefined) {
      throw new Error(
        "--offset has no effect with --project (that endpoint is cursor-paginated only) — use --cursor instead.",
      );
    }
    const page = await fetchProjectConversationsPage(
      creds,
      project,
      cursor,
      limit,
    );
    console.error(
      `fetched ${page.items.length} conversation(s) from project ${project}`,
    );
    if (page.cursor) console.error(`next cursor: ${page.cursor}`);
    printConversationSummaries(page.items);

    if (cacheDir) {
      const index = await readProjectIndex(cacheDir);
      const filename = index.get(project);
      if (!filename) {
        throw new Error(
          `No cached metadata for project ${project}. Run 'list-projects --cache-dir <dir>' first so its list cache has a resolvable filename.`,
        );
      }
      await cacheConversationPage(
        cacheDir,
        page.items,
        filename,
        `projects/${filename}`,
      );
    }
    return;
  }

  if (cursor !== undefined) {
    throw new Error(
      "--cursor only applies with --project — use --offset/--limit here.",
    );
  }

  const page = await fetchConversationsPage(creds, offset, limit);
  console.error(
    `fetched ${page.items.length} conversation(s) at offset ${page.offset} (${page.total} total)`,
  );
  printConversationSummaries(page.items);

  if (cacheDir) {
    await cacheConversationPage(
      cacheDir,
      page.items,
      undefined,
      "projects/default.jsonl",
    );
  }
}

async function runListProjects(
  cursor: string | undefined,
  limit: number | undefined,
  { cacheDir }: CacheOptions,
): Promise<void> {
  const creds = loadCredentials();
  if (!creds) throw new Error("No saved credentials. Run 'login' first.");

  const page = await fetchProjectsPage(creds, cursor, limit);
  console.error(`fetched ${page.items.length} project(s)`);
  if (page.cursor) console.error(`next cursor: ${page.cursor}`);

  for (const item of page.items) {
    console.log(
      JSON.stringify({
        create_time: item.create_time,
        id: item.id,
        title: item.title,
      }),
    );
  }

  if (cacheDir) {
    await appendProjectIndex(cacheDir, page.items);
    console.error(
      `indexed ${page.items.length} project(s) to projects/index.jsonl`,
    );
  }
}

async function main() {
  const parsed = new ArgsParser(args());
  const [command] = parsed.getLoose();

  if (command === "login") {
    return runLogin();
  }

  if (command === "list-conversations") {
    const offsetRaw = parsed.get("offset") as string | undefined;
    const limitRaw = parsed.get("limit") as string | undefined;
    const cursor = parsed.get("cursor") as string | undefined;
    const project = parsed.get("project") as string | undefined;
    const cacheOptions = resolveCacheOptions(parsed);
    return runListConversations(
      {
        offset: offsetRaw !== undefined ? Number(offsetRaw) : undefined,
        limit: limitRaw !== undefined ? Number(limitRaw) : undefined,
        cursor,
        project,
      },
      cacheOptions,
    );
  }

  if (command === "list-projects") {
    const cursor = parsed.get("cursor") as string | undefined;
    const limitRaw = parsed.get("limit") as string | undefined;
    const cacheOptions = resolveCacheOptions(parsed);
    return runListProjects(
      cursor,
      limitRaw !== undefined ? Number(limitRaw) : undefined,
      cacheOptions,
    );
  }

  if (command === "get-conversation") {
    const [, id] = parsed.getLoose();
    if (!id) {
      console.error(
        "Usage: chatgpt-access get-conversation <id> [--cache-dir <dir>] [--cache-max-age <duration>]",
      );
      exit(1);
      return;
    }
    const cacheOptions = resolveCacheOptions(parsed);
    return runGetConversation(id, cacheOptions);
  }

  console.error(
    "Usage: chatgpt-access <login|list-projects|list-conversations|get-conversation> [args...]",
  );
  exit(1);
}

if (import.meta.main) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    exit(1);
  });
}
