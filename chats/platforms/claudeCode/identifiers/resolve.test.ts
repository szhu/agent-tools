import { join } from "@std/path";
import { describe, expect, test } from "bun:test";
import type { ClaudeCodeContext } from "../data/storage.ts";
import { resolveAddress } from "./resolve.ts";

const fixturesDir = join(import.meta.dirname, "../fixtures/projects");
const context: ClaudeCodeContext = { projectsDir: fixturesDir };

const alphaProjectPath = "/Users/alice/Code/project-alpha";
const alphaDir = join(fixturesDir, "-Users-alice-Code-project-alpha");
const betaProjectPath = "/Users/alice/Code/project-beta";
const betaDir = join(fixturesDir, "-Users-alice-Code-project-beta");

describe("resolveAddress", () => {
  test("all projects when pathInput is /", async () => {
    const result = await resolveAddress(
      { pathInput: "/" },
      "/any/cwd",
      context,
    );
    expect(result).toEqual({ type: "all" });
  });

  test("project by explicit path", async () => {
    const result = await resolveAddress(
      { pathInput: alphaProjectPath },
      "/any/cwd",
      context,
    );
    expect(result).toEqual({
      type: "project",
      projectPath: alphaProjectPath,
      projectDir: alphaDir,
    });
  });

  test("project by cwd (pathInput undefined defaults to cwd)", async () => {
    const result = await resolveAddress({}, alphaProjectPath, context);
    expect(result).toEqual({
      type: "project",
      projectPath: alphaProjectPath,
      projectDir: alphaDir,
    });
  });

  test("project by pathInput '.' uses cwd", async () => {
    const result = await resolveAddress(
      { pathInput: "." },
      alphaProjectPath,
      context,
    );
    expect(result).toEqual({
      type: "project",
      projectPath: alphaProjectPath,
      projectDir: alphaDir,
    });
  });

  test("chat by id prefix", async () => {
    const result = await resolveAddress(
      { pathInput: alphaProjectPath, chatInput: "aaaaaaaa-1111" },
      "/any/cwd",
      context,
    );
    expect(result.type).toBe("chat");
    if (result.type === "chat") {
      expect(result.chatId).toBe("aaaaaaaa-1111-0000-0000-000000000000");
      expect(result.projectPath).toBe(alphaProjectPath);
      expect(result.projectDir).toBe(alphaDir);
    }
  });

  test("message by id prefix", async () => {
    const result = await resolveAddress(
      {
        pathInput: alphaProjectPath,
        chatInput: "aaaaaaaa-1111",
        messagesInput: "10000001",
      },
      "/any/cwd",
      context,
    );
    expect(result.type).toBe("messages");
    if (result.type === "messages") {
      expect(result.messageId).toBe("10000001-0000-0000-0000-000000000000");
    }
  });

  test(".jsonl direct path resolves to chat", async () => {
    const chatPath = join(
      alphaDir,
      "aaaaaaaa-1111-0000-0000-000000000000.jsonl",
    );
    const result = await resolveAddress(
      { pathInput: chatPath },
      "/any/cwd",
      context,
    );
    expect(result.type).toBe("chat");
    if (result.type === "chat") {
      expect(result.chatId).toBe("aaaaaaaa-1111-0000-0000-000000000000");
      expect(result.chatPath).toBe(chatPath);
      expect(result.projectDir).toBe(alphaDir);
      expect(result.projectPath).toBeUndefined();
    }
  });

  test("resolves beta project", async () => {
    const result = await resolveAddress(
      { pathInput: betaProjectPath },
      "/any/cwd",
      context,
    );
    expect(result).toEqual({
      type: "project",
      projectPath: betaProjectPath,
      projectDir: betaDir,
    });
  });

  test("throws for unknown project", async () => {
    await expect(
      resolveAddress(
        { pathInput: "/Users/alice/Code/unknown" },
        "/any/cwd",
        context,
      ),
    ).rejects.toThrow("Project not found");
  });
});
