import { dir } from "@cross/dir";
import { join } from "@std/path";
import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import type { ConversationSummary } from "./api.ts";
import {
  appendListCachePage,
  isFresh,
  isVerifiedAdjacent,
  readListCache,
  type ListCacheEntry,
} from "./cache.ts";

async function withTempDir(fn: (path: string) => Promise<void>): Promise<void> {
  const path = await mkdtemp(
    join(await dir("tmp"), "chatgpt-access-cache-test-"),
  );
  try {
    await fn(path);
  } finally {
    await rm(path, { recursive: true, force: true });
  }
}

function summary(id: string, updateTime: string): ConversationSummary {
  return { id, title: `Conversation ${id}`, update_time: updateTime };
}

describe("appendListCachePage / readListCache", () => {
  test("merges a page's items, setting prev/next from what was actually adjacent", async () => {
    await withTempDir(async (dir) => {
      const page = [
        summary("a", "2026-01-03T00:00:00.000Z"),
        summary("b", "2026-01-02T00:00:00.000Z"),
        summary("c", "2026-01-01T00:00:00.000Z"),
      ];
      await appendListCachePage(
        dir,
        page,
        new Date("2026-01-04T00:00:00.000Z"),
      );
      const map = await readListCache(dir);

      expect(map.size).toBe(3);
      expect(map.get("a")).toMatchObject({
        prev_update_time: null,
        next_update_time: "2026-01-02T00:00:00.000Z",
      });
      expect(map.get("b")).toMatchObject({
        prev_update_time: "2026-01-03T00:00:00.000Z",
        next_update_time: "2026-01-01T00:00:00.000Z",
      });
      expect(map.get("c")).toMatchObject({
        prev_update_time: "2026-01-02T00:00:00.000Z",
        next_update_time: null,
      });
    });
  });

  test("a later append with a matching id overwrites the earlier entry on read (last-write-wins)", async () => {
    await withTempDir(async (dir) => {
      await appendListCachePage(
        dir,
        [summary("a", "2026-01-01T00:00:00.000Z")],
        new Date("2026-01-01T00:00:00.000Z"),
      );
      await appendListCachePage(
        dir,
        [summary("a", "2026-01-05T00:00:00.000Z")],
        new Date("2026-01-05T00:00:00.000Z"),
      );
      const map = await readListCache(dir);

      expect(map.size).toBe(1);
      expect(map.get("a")?.update_time).toBe("2026-01-05T00:00:00.000Z");
    });
  });

  test("reading a nonexistent cache dir returns an empty map", async () => {
    await withTempDir(async (dir) => {
      const map = await readListCache(join(dir, "does-not-exist"));
      expect(map.size).toBe(0);
    });
  });
});

describe("isVerifiedAdjacent", () => {
  function entry(overrides: Partial<ListCacheEntry>): ListCacheEntry {
    return {
      id: "x",
      title: "x",
      update_time: "2026-01-01T00:00:00.000Z",
      fetched_at: "2026-01-01T00:00:00.000Z",
      prev_update_time: null,
      next_update_time: null,
      ...overrides,
    };
  }

  test("true when one fetch observed both entries adjacent to each other", () => {
    const newer = entry({
      update_time: "2026-01-02T00:00:00.000Z",
      next_update_time: "2026-01-01T00:00:00.000Z",
    });
    const older = entry({
      update_time: "2026-01-01T00:00:00.000Z",
      prev_update_time: "2026-01-02T00:00:00.000Z",
    });
    expect(isVerifiedAdjacent(newer, older)).toBe(true);
  });

  test("false when neither entry's neighbor fields confirm the adjacency (an unverified gap)", () => {
    // Simulates two separate fetches that each only walked partway, never
    // overlapping — e.g. one from two days ago that reached "b", and one
    // from today that only reached "a": nothing has ever confirmed a and b
    // sit next to each other, even though they're adjacent by update_time.
    const newer = entry({
      update_time: "2026-01-02T00:00:00.000Z",
      next_update_time: null,
    });
    const older = entry({
      update_time: "2026-01-01T00:00:00.000Z",
      prev_update_time: null,
    });
    expect(isVerifiedAdjacent(newer, older)).toBe(false);
  });
});

describe("isFresh", () => {
  test("true when fetched within the max age", () => {
    const fetchedAt = new Date(Date.now() - 1000);
    expect(isFresh(fetchedAt, 60_000)).toBe(true);
  });

  test("false when older than the max age", () => {
    const fetchedAt = new Date(Date.now() - 120_000);
    expect(isFresh(fetchedAt, 60_000)).toBe(false);
  });

  test("false for any age when max age is 0 (force-refresh)", () => {
    const fetchedAt = new Date();
    expect(isFresh(fetchedAt, 0)).toBe(false);
  });
});
