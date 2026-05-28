import { dir } from "@cross/dir";
import { join } from "@std/path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { renameChat } from "./renameChat.ts";

const fixturesDir = join(import.meta.dirname, "../fixtures/projects");

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(await dir("tmp"), "chats-test-"));
  await cp(fixturesDir, tempDir, { recursive: true });
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("renameChat", () => {
  test("appends custom-title entry to file", async () => {
    const chatPath = join(
      tempDir,
      "-Users-alice-Code-project-alpha",
      "aaaaaaaa-1111-0000-0000-000000000000.jsonl",
    );
    await renameChat(chatPath, "My New Title");
    const content = await readFile(chatPath, "utf-8");
    const lines = content.trim().split("\n");
    const lastLine = lines[lines.length - 1];
    const lastEntry = JSON.parse(lastLine!) as Record<string, unknown>;
    expect(lastEntry).toEqual({
      type: "custom-title",
      customTitle: "My New Title",
      sessionId: "aaaaaaaa-1111-0000-0000-000000000000",
    });
  });

  test("renamed title is read back by loadChat", async () => {
    const chatPath = join(
      tempDir,
      "-Users-alice-Code-project-alpha",
      "aaaaaaaa-1111-0000-0000-000000000000.jsonl",
    );
    await renameChat(chatPath, "Updated Title");
    const { loadChat } = await import("../data/storage.ts");
    const chat = await loadChat(chatPath);
    expect(chat.title).toBe("Updated Title");
  });

  test("original messages are still present after rename", async () => {
    const chatPath = join(
      tempDir,
      "-Users-alice-Code-project-alpha",
      "aaaaaaaa-1111-0000-0000-000000000000.jsonl",
    );
    const { loadChat } = await import("../data/storage.ts");
    const before = await loadChat(chatPath);
    const originalUuids = before.messages.map((m) => m.uuid);
    await renameChat(chatPath, "Another Title");
    const after = await loadChat(chatPath);
    for (const uuid of originalUuids) {
      expect(after.messages.some((m) => m.uuid === uuid)).toBe(true);
    }
  });
});
