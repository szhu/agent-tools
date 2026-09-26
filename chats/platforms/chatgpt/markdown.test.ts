import { join } from "@std/path";
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import type { ConversationDetail, ConversationNode } from "./api.ts";
import { activeMessagePath, toMarkdown } from "./markdown.ts";

const fixturePath = join(
  import.meta.dirname,
  "fixtures/branching-conversation.json",
);

const FIXED_FETCHED_AT = new Date("2026-01-01T00:00:00.000Z");

async function loadFixture(): Promise<ConversationDetail> {
  return JSON.parse(await readFile(fixturePath, "utf-8"));
}

describe("activeMessagePath", () => {
  test("follows current_node up to root, excluding dead regeneration branches", async () => {
    const detail = await loadFixture();
    const path = activeMessagePath(detail);
    expect(path.length).toBe(3);
    expect(
      path.map((m: ConversationNode["message"]) => m?.author.role),
    ).toEqual(["user", "assistant", "user"]);
  });

  test("skips the null-message root node", async () => {
    const detail = await loadFixture();
    const path = activeMessagePath(detail);
    expect(path.every((m: ConversationNode["message"]) => m !== null)).toBe(
      true,
    );
  });
});

describe("toMarkdown", () => {
  test("includes YAML frontmatter with id, ISO timestamps, and fetched_at", async () => {
    const detail = await loadFixture();
    const markdown = toMarkdown("conv-123", detail, FIXED_FETCHED_AT);
    expect(markdown).toContain("---\nid: conv-123\n");
    expect(markdown).toContain("create_time: 2023-11-14T22:13:20.000Z\n");
    expect(markdown).toContain("update_time: 2023-11-14T22:18:20.000Z\n");
    expect(markdown).toContain("fetched_at: 2026-01-01T00:00:00.000Z\n");
  });

  test("excludes the dead regeneration branch", async () => {
    const detail = await loadFixture();
    const markdown = toMarkdown("conv-123", detail, FIXED_FETCHED_AT);
    expect(markdown).not.toContain("dead regeneration branch");
  });

  test("joins multi-part message content with a newline between parts", async () => {
    const detail = await loadFixture();
    const markdown = toMarkdown("conv-123", detail, FIXED_FETCHED_AT);
    expect(markdown).toContain(
      "Any tips for making it less greasy?\nAlso, what sides go well with it?",
    );
  });

  test("includes a timestamp in each message header", async () => {
    const detail = await loadFixture();
    const markdown = toMarkdown("conv-123", detail, FIXED_FETCHED_AT);
    expect(markdown).toContain("## user (2023-11-14T22:13:30.000Z)");
    expect(markdown).toContain("## assistant (2023-11-14T22:14:20.000Z)");
  });

  test("replaces a substantial citation placeholder with its Markdown link", async () => {
    const detail = await loadFixture();
    const markdown = toMarkdown("conv-123", detail, FIXED_FETCHED_AT);
    expect(markdown).toContain(
      "Fried rice is a great option.([Example](https://example.com/fried-rice))",
    );
    expect(markdown).not.toContain("citeturn1search0");
  });

  test("leaves a single-space sources-footnote placeholder untouched", async () => {
    const detail = await loadFixture();
    const markdown = toMarkdown("conv-123", detail, FIXED_FETCHED_AT);
    expect(markdown).toContain("Some people also swap in cauliflower rice.");
  });
});
