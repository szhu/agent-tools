import { readdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { ClaudeCodeChat, ClaudeCodeMessage } from "./types.ts";

export type ClaudeCodeContext = { projectsDir: string };

export function defaultContext(): ClaudeCodeContext {
  return { projectsDir: join(homedir(), ".claude", "projects") };
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
  const messages = entries.filter((e) => e["uuid"]) as ClaudeCodeMessage[];
  const titleEntry =
    entries.findLast((e) => e["type"] === "custom-title") ??
    entries.find((e) => e["type"] === "ai-title");
  const title = (titleEntry?.["customTitle"] ?? titleEntry?.["aiTitle"]) as
    | string
    | undefined;
  return {
    id: basename(filePath, ".jsonl"),
    filePath,
    projectDir: join(filePath, ".."),
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

export async function listAllProjects(
  context: ClaudeCodeContext,
): Promise<{ dir: string; encoded: string }[]> {
  const dirs = await readdir(context.projectsDir, { withFileTypes: true });
  return dirs
    .filter((d) => d.isDirectory())
    .map((d) => ({ dir: join(context.projectsDir, d.name), encoded: d.name }));
}

export function resolveChat(
  chats: ClaudeCodeChat[],
  prefix: string,
): ClaudeCodeChat {
  const matches = chats.filter((c) => c.id.startsWith(prefix));
  if (matches.length === 0) throw new Error(`No chat matching '${prefix}'`);
  if (matches.length > 1)
    throw new Error(
      `Ambiguous prefix '${prefix}': ${matches.map((c) => c.id.slice(0, 8)).join(", ")}`,
    );
  return matches[0]!;
}

export function resolveMessage(
  messages: ClaudeCodeMessage[],
  prefix: string,
): ClaudeCodeMessage {
  const matches = messages.filter((m) => m.uuid.startsWith(prefix));
  if (matches.length === 0) throw new Error(`No message matching '${prefix}'`);
  if (matches.length > 1)
    throw new Error(
      `Ambiguous prefix '${prefix}': ${matches.map((m) => m.uuid.slice(0, 8)).join(", ")}`,
    );
  return matches[0]!;
}

export async function appendTitle(
  filePath: string,
  title: string,
): Promise<void> {
  const sessionId = basename(filePath, ".jsonl");
  const entry = {
    type: "custom-title",
    customTitle: title,
    sessionId,
    uuid: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
  };
  await writeFile(
    filePath,
    (await readFile(filePath, "utf-8")) + JSON.stringify(entry) + "\n",
  );
}

export async function moveChatFile(
  srcPath: string,
  destDir: string,
): Promise<void> {
  await rename(srcPath, join(destDir, basename(srcPath)));
}
