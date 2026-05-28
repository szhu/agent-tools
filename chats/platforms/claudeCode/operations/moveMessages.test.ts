import { dir } from "@cross/dir";
import { join } from "@std/path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cp, mkdtemp, readdir, rm } from "node:fs/promises";
import { moveChat } from "./moveMessages.ts";

const fixturesDir = join(import.meta.dirname, "../fixtures/projects");

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(await dir("tmp"), "chats-test-"));
  await cp(fixturesDir, tempDir, { recursive: true });
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("moveChat", () => {
  test("moves chat file to destination directory", async () => {
    const srcPath = join(
      tempDir,
      "-Users-alice-Code-project-alpha",
      "aaaaaaaa-1111-0000-0000-000000000000.jsonl",
    );
    const destDir = join(tempDir, "-Users-alice-Code-project-beta");
    await moveChat(srcPath, destDir);
    const destFiles = await readdir(destDir);
    expect(destFiles).toContain("aaaaaaaa-1111-0000-0000-000000000000.jsonl");
  });

  test("removes file from source directory after move", async () => {
    const srcDir = join(tempDir, "-Users-alice-Code-project-alpha");
    const srcPath = join(srcDir, "aaaaaaaa-1111-0000-0000-000000000000.jsonl");
    const destDir = join(tempDir, "-Users-alice-Code-project-beta");
    await moveChat(srcPath, destDir);
    const srcFiles = await readdir(srcDir);
    expect(srcFiles).not.toContain(
      "aaaaaaaa-1111-0000-0000-000000000000.jsonl",
    );
  });

  test("source directory still has remaining chats", async () => {
    const srcDir = join(tempDir, "-Users-alice-Code-project-alpha");
    const srcPath = join(srcDir, "aaaaaaaa-1111-0000-0000-000000000000.jsonl");
    const destDir = join(tempDir, "-Users-alice-Code-project-beta");
    await moveChat(srcPath, destDir);
    const srcFiles = await readdir(srcDir);
    expect(srcFiles).toContain("aaaaaaaa-2222-0000-0000-000000000000.jsonl");
  });
});
