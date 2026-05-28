import { dir } from "@cross/dir";
import { basename, dirname, join } from "@std/path";
import { readdir, readFile, writeFile } from "node:fs/promises";
import type { ClaudeCodeChat, ClaudeCodeMessage } from "./types.ts";

export type ClaudeCodeContext = { projectsDir: string };

export async function defaultContext(): Promise<ClaudeCodeContext> {
  return { projectsDir: join(await dir("home"), ".claude", "projects") };
}

// Encoding is lossy (/ and . both become -), so we encode to search, never decode
export function encodeProjectPath(p: string): string {
  return p.replace(/[/.]/g, "-");
}

async function readJsonl(filePath: string): Promise<Record<string, unknown>[]> {
  const text = await readFile(filePath, "utf-8");
  return text
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line: string) => JSON.parse(line) as Record<string, unknown>);
}

export async function loadChat(filePath: string): Promise<ClaudeCodeChat> {
  const entries = await readJsonl(filePath);
  const messages = entries as ClaudeCodeMessage[];
  const titleEntry =
    entries.findLast((e) => e["type"] === "custom-title") ??
    entries.find((e) => e["type"] === "ai-title");
  const title = (titleEntry?.["customTitle"] ?? titleEntry?.["aiTitle"]) as
    | string
    | undefined;
  return {
    id: basename(filePath, ".jsonl"),
    filePath,
    projectDir: dirname(filePath),
    title,
    messages,
  };
}

export async function listChats(projectDir: string): Promise<ClaudeCodeChat[]> {
  const files = (await readdir(projectDir)).filter((f: string) =>
    f.endsWith(".jsonl"),
  );
  return Promise.all(files.map((f: string) => loadChat(join(projectDir, f))));
}

export async function findProjectDir(
  context: ClaudeCodeContext,
  projectPath: string,
): Promise<string | undefined> {
  const encoded = encodeProjectPath(projectPath);
  const dirs = await readdir(context.projectsDir);
  const match = dirs.find((d: string) => d === encoded);
  return match ? join(context.projectsDir, match) : undefined;
}

export async function listProjectDirs(
  context: ClaudeCodeContext,
): Promise<{ dir: string; encoded: string }[]> {
  const dirs = await readdir(context.projectsDir, { withFileTypes: true });
  return dirs
    .filter((d) => d.isDirectory())
    .map((d) => ({ dir: join(context.projectsDir, d.name), encoded: d.name }));
}

export async function appendChatEntry(
  filePath: string,
  entry: Record<string, unknown>,
): Promise<void> {
  await writeFile(
    filePath,
    (await readFile(filePath, "utf-8")) + JSON.stringify(entry) + "\n",
  );
}

