import { ArgsParser, args, exit } from "@cross/utils";
import { resolve } from "@std/path";
import { fetchConversationDetail, fetchConversationsPage } from "./api.ts";
import { loadCredentials, runLogin } from "./auth.ts";
import {
  appendListCachePage,
  findCachedConversation,
  isFresh,
  isVerifiedAdjacent,
  readCachedConversation,
  readListCache,
  writeCachedConversation,
} from "./cache.ts";
import { toMarkdown } from "./markdown.ts";

function parseDurationMs(input: string): number {
  const match = input.match(/^(\d+)(ms|s|m|h|d)$/);
  if (!match || !match[1] || !match[2]) {
    throw new Error(
      `Invalid duration '${input}'. Use a number followed by ms, s, m, h, or d (e.g. 24h).`,
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

async function runListConversations(
  offset: number | undefined,
  limit: number | undefined,
  { cacheDir }: CacheOptions,
): Promise<void> {
  const creds = loadCredentials();
  if (!creds) throw new Error("No saved credentials. Run 'login' first.");

  const page = await fetchConversationsPage(creds, offset, limit);
  console.error(
    `fetched ${page.items.length} conversation(s) at offset ${page.offset} (${page.total} total)`,
  );

  for (const item of page.items) {
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

  if (cacheDir) {
    const fetchedAt = new Date();
    const before = await readListCache(cacheDir);
    await appendListCachePage(cacheDir, page.items, fetchedAt);
    let gaps = 0;
    for (let i = 0; i < page.items.length - 1; i++) {
      const newerId = page.items[i]!.id;
      const olderId = page.items[i + 1]!.id;
      const newer = before.get(newerId);
      const older = before.get(olderId);
      if (newer && older && !isVerifiedAdjacent(newer, older)) gaps++;
    }
    console.error(`cached ${page.items.length} row(s) to ${cacheDir}`);
    if (gaps > 0) {
      console.error(
        `warning: ${gaps} previously-cached adjacency(s) in this range are unverified — a fetch may have skipped over them`,
      );
    }
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
    const cacheOptions = resolveCacheOptions(parsed);
    return runListConversations(
      offsetRaw !== undefined ? Number(offsetRaw) : undefined,
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
    "Usage: chatgpt-access <login|list-conversations|get-conversation> [args...]",
  );
  exit(1);
}

if (import.meta.main) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    exit(1);
  });
}
