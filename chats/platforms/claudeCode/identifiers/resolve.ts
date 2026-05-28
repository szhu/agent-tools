import { basename, dirname } from "@std/path";
import type { ClaudeCodeContext } from "../data/storage.ts";
import { findProjectDir, listChats, loadChat } from "../data/storage.ts";
import type { ClaudeCodeChat, ClaudeCodeMessage } from "../data/types.ts";
import { parseRange } from "./parse.ts";
import type { RawAddress, ResolvedAddress } from "./types.ts";

function resolveChat(chats: ClaudeCodeChat[], prefix: string): ClaudeCodeChat {
  const matches = chats.filter((c) => c.id.startsWith(prefix));
  if (matches.length === 0) throw new Error(`No chat matching '${prefix}'`);
  if (matches.length > 1)
    throw new Error(
      `Ambiguous prefix '${prefix}': ${matches.map((c) => c.id.slice(0, 8)).join(", ")}`,
    );
  return matches[0]!;
}

function resolveMessage(
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

export async function resolveAddress(
  raw: RawAddress,
  cwdPath: string,
  context: ClaudeCodeContext,
): Promise<ResolvedAddress> {
  const pathInput = raw.pathInput ?? cwdPath;

  if (pathInput === "/") return { type: "all" };

  const isJsonl = pathInput.endsWith(".jsonl");
  let projectPath: string | undefined;
  let projectDir: string;
  let chatPath: string | undefined;

  if (isJsonl) {
    projectDir = dirname(pathInput);
    chatPath = pathInput;
  } else {
    projectPath = pathInput === "." ? cwdPath : pathInput;
    const dir = await findProjectDir(context, projectPath);
    if (!dir) throw new Error(`Project not found: ${projectPath}`);
    projectDir = dir;
  }

  if (!raw.chatInput && !isJsonl) {
    return { type: "project", projectPath: projectPath!, projectDir };
  }

  if (!chatPath) {
    const chats = await listChats(projectDir);
    const chat = resolveChat(chats, raw.chatInput!);
    chatPath = chat.filePath;
  }

  const chatId = basename(chatPath, ".jsonl");

  if (!raw.messagesInput) {
    return { type: "chat", projectPath, projectDir, chatId, chatPath };
  }

  const chat = await loadChat(chatPath);
  const chatMessages = chat.messages.filter((m) => m.uuid);
  const range = parseRange(raw.messagesInput);

  if (range) {
    const startMessage = resolveMessage(chatMessages, range.start);
    const endMessage = resolveMessage(chatMessages, range.end);
    return {
      type: "messages",
      projectPath,
      projectDir,
      chatId,
      chatPath,
      messageIds: {
        start: startMessage.uuid,
        startInclusive: range.startInclusive,
        end: endMessage.uuid,
        endInclusive: range.endInclusive,
      },
    };
  }

  const message = resolveMessage(chatMessages, raw.messagesInput);
  return {
    type: "messages",
    projectPath,
    projectDir,
    chatId,
    chatPath,
    messageId: message.uuid,
    messageIds: {
      start: message.uuid,
      startInclusive: true,
      end: message.uuid,
      endInclusive: true,
    },
  };
}
