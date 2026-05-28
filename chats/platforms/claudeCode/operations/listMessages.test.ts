import { join } from "@std/path";
import { describe, expect, test } from "bun:test";
import { listMessages } from "./listMessages.ts";

const fixturesDir = join(import.meta.dirname, "../fixtures/projects");
const chat1Path = join(
  fixturesDir,
  "-Users-alice-Code-project-alpha",
  "aaaaaaaa-1111-0000-0000-000000000000.jsonl",
);
const chat3Path = join(
  fixturesDir,
  "-Users-alice-Code-project-beta",
  "bbbbbbbb-1111-0000-0000-000000000000.jsonl",
);

describe("listMessages", () => {
  test("returns chat and messages", async () => {
    const result = await listMessages(chat1Path);
    expect(result.chat).toBeDefined();
    expect(Array.isArray(result.messages)).toBe(true);
  });

  test("filters to only messages with uuid", async () => {
    const result = await listMessages(chat1Path);
    for (const message of result.messages) {
      expect(message.uuid).toBeTruthy();
    }
  });

  test("returns correct message count for chat 1", async () => {
    const result = await listMessages(chat1Path);
    expect(result.messages.length).toBe(4);
  });

  test("returns chat title", async () => {
    const result = await listMessages(chat1Path);
    expect(result.chat.title).toBe("Getting started with TypeScript");
  });

  test("messages have expected UUIDs for chat 3", async () => {
    const result = await listMessages(chat3Path);
    const uuids = result.messages.map((m) => m.uuid);
    expect(uuids).toContain("30000001-0000-0000-0000-000000000000");
    expect(uuids).toContain("30000002-0000-0000-0000-000000000000");
  });
});
