import { readdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { parseRange } from "../identifiers/parse.ts";
import type { RawAddress, ResolvedAddress } from "../identifiers/types.ts";

export type ClaudeCodeMessage = {
  uuid: string;
  parentUuid: string | null;
  type: string;
  timestamp?: string;
  isSidechain?: boolean;
  message?: { role: string; content: unknown };
  [key: string]: unknown;
};

export type ClaudeCodeChat = {
  id: string;
  filePath: string;
  projectDir: string;
  title?: string;
  messages: ClaudeCodeMessage[];
};

export const claudeProjectsDir = join(homedir(), ".claude", "projects");

// Encoding is lossy (/ and . both become -), so we encode to search, never decode
export const encodeProjectPath = (p: string) => p.replace(/[/.]/g, "-");

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
  projectPath: string,
): Promise<string | undefined> {
  const encoded = encodeProjectPath(projectPath);
  const dirs = await readdir(claudeProjectsDir);
  const match = dirs.find((d: string) => d === encoded);
  return match ? join(claudeProjectsDir, match) : undefined;
}

export async function listAllProjects(): Promise<
  { dir: string; encoded: string }[]
> {
  const dirs = await readdir(claudeProjectsDir, { withFileTypes: true });
  return dirs
    .filter((d) => d.isDirectory())
    .map((d) => ({ dir: join(claudeProjectsDir, d.name), encoded: d.name }));
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

export async function resolveAddress(
  raw: RawAddress,
  cwdPath: string,
): Promise<ResolvedAddress> {
  const pathInput = raw.pathInput ?? cwdPath;

  if (pathInput === "/") return { type: "all" };

  const isJsonl = pathInput.endsWith(".jsonl");
  let projectPath: string;
  let jsonlDir: string;
  let jsonlPath: string | undefined;

  if (isJsonl) {
    projectPath = dirname(pathInput);
    jsonlDir = projectPath;
    jsonlPath = pathInput;
  } else {
    projectPath = pathInput === "." ? cwdPath : pathInput;
    const dir = await findProjectDir(projectPath);
    if (!dir) throw new Error(`Project not found: ${projectPath}`);
    jsonlDir = dir;
  }

  if (!raw.chatInput && !isJsonl) {
    return { type: "project", projectPath, jsonlDir };
  }

  if (!jsonlPath) {
    const chats = await listChats(jsonlDir);
    const chat = resolveChat(chats, raw.chatInput!);
    jsonlPath = chat.filePath;
  }

  const chatId = basename(jsonlPath, ".jsonl");

  if (!raw.messagesInput) {
    return { type: "chat", projectPath, jsonlPath, chatId };
  }

  const chat = await loadChat(jsonlPath);
  const range = parseRange(raw.messagesInput);

  if (range) {
    const startMessage = resolveMessage(chat.messages, range.start);
    const endMessage = resolveMessage(chat.messages, range.end);
    return {
      type: "messages",
      projectPath,
      jsonlPath,
      chatId,
      messageIds: {
        start: startMessage.uuid,
        startInclusive: range.startInclusive,
        end: endMessage.uuid,
        endInclusive: range.endInclusive,
      },
    };
  }

  const message = resolveMessage(chat.messages, raw.messagesInput);
  return {
    type: "messages",
    projectPath,
    jsonlPath,
    chatId,
    messageId: message.uuid,
    messageIds: {
      start: message.uuid,
      startInclusive: true,
      end: message.uuid,
      endInclusive: true,
    },
  };
}

export async function moveChatFile(
  srcPath: string,
  destDir: string,
): Promise<void> {
  await rename(srcPath, join(destDir, basename(srcPath)));
}
