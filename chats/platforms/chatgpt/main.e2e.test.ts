/**
 * End-to-end validation against the real ChatGPT backend API — no dummy account
 * exists, so this hits whatever account `chatgpt-access login` has saved
 * credentials for.
 *
 * Covers API-shape drift, not logic (the fixture tests already cover logic with
 * zero network cost): pagination params actually taking effect, the message
 * tree walk surviving real conversations (which include content types and roles
 * the fixtures don't — `thoughts`, `reasoning_recap`, `role: "tool"` — silently
 * dropped by design; a genuinely new shape should still leave user/assistant
 * text intact), and the file cache round-tripping against a live detail
 * response.
 *
 * At most 6 network calls total, budgeted well under the 10-call limit, shared
 * across every test via `beforeAll` — don't add a per-test fetch. Not logged in
 * (or a stale/expired credential) is a real failure and throws. `bun:test`'s
 * `skipIf` only evaluates at declaration time, before `beforeAll` has run, so
 * it can't act on "this account has no conversations" — a test whose
 * precondition isn't met returns early instead, which bun reports as passed
 * rather than skipped.
 *
 * Off by default. Enable with `TEST_E2E=1 bun test`. Requires `chatgpt-access
 * login` to have been run at least once on this machine.
 */

import { dir } from "@cross/dir";
import { join } from "@std/path";
import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import type { ConversationDetail, ConversationsPage } from "./api.ts";
import { fetchConversationDetail, fetchConversationsPage } from "./api.ts";
import { loadCredentials } from "./auth.ts";
import {
  findCachedConversation,
  isFresh,
  writeCachedConversation,
} from "./cache.ts";
import { toMarkdown } from "./markdown.ts";

const E2E = process.env["TEST_E2E"] === "1";

describe.skipIf(!E2E)("chatgpt-access e2e", () => {
  let firstPage: ConversationsPage;
  let secondPage: ConversationsPage;
  let details: ConversationDetail[];

  beforeAll(async () => {
    const creds = loadCredentials();
    if (!creds) {
      throw new Error(
        "No saved credentials. Run `chatgpt-access login` on this machine first.",
      );
    }
    firstPage = await fetchConversationsPage(creds); // call 1
    secondPage = await fetchConversationsPage(creds, 50, 10); // call 2
    details = await Promise.all(
      firstPage.items
        .slice(0, 3)
        .map((item) => fetchConversationDetail(item.id, creds)), // calls 3-5
    );
  });

  test("list-conversations returns a page of real conversations", () => {
    expect(firstPage.items.length).toBeGreaterThan(0);
    for (const item of firstPage.items) {
      expect(item.id.length).toBeGreaterThan(0);
      expect(item.title.length).toBeGreaterThan(0);
      expect(Number.isNaN(Date.parse(item.update_time))).toBe(false);
    }
    expect(firstPage.offset).toBe(0);
  });

  test("offset/limit actually change what the API returns", () => {
    if (firstPage.total <= 50) return; // account doesn't have a second page
    expect(secondPage.offset).toBe(50);
    expect(secondPage.limit).toBe(10);
    expect(secondPage.items.length).toBeLessThanOrEqual(10);
    const firstPageIds = new Set(firstPage.items.map((i) => i.id));
    for (const item of secondPage.items) {
      expect(firstPageIds.has(item.id)).toBe(false);
    }
  });

  test("each fetched conversation's current_node exists in its mapping", () => {
    for (const detail of details) {
      expect(detail.mapping[detail.current_node]).toBeDefined();
    }
  });

  test("toMarkdown produces a non-empty transcript for each conversation", () => {
    for (const [i, detail] of details.entries()) {
      const markdown = toMarkdown(firstPage.items[i]!.id, detail, new Date());
      expect(markdown.startsWith(`---\nid: ${firstPage.items[i]!.id}\n`)).toBe(
        true,
      );
      // Not every message role renders (tool calls, reasoning, etc. are
      // dropped by design — see the file-level comment) but every real
      // conversation should still surface at least one visible exchange.
      expect(markdown).toMatch(/## user/);
      expect(markdown).toMatch(/## assistant/);
    }
  });

  test("a cached conversation round-trips through find/write/isFresh", async () => {
    const cacheDir = await mkdtemp(
      join(await dir("tmp"), "chatgpt-access-e2e-cache-"),
    );
    try {
      const id = firstPage.items[0]!.id;
      const detail = details[0]!;
      const fetchedAt = new Date();
      await writeCachedConversation(cacheDir, id, detail, fetchedAt);

      const cached = await findCachedConversation(cacheDir, id);
      expect(cached).not.toBeNull();
      expect(cached!.fetchedAt.toISOString()).toBe(fetchedAt.toISOString());
      expect(isFresh(cached!.fetchedAt, 60_000)).toBe(true);
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
    }
  });
});
