import { basename, dirname } from "@std/path";
import type { ClaudeCodeContext } from "../data/storage.ts";
import {
  findProjectDir,
  listChats,
  loadChat,
  resolveChat,
  resolveMessage,
} from "../data/storage.ts";
import { parseRange } from "./parse.ts";
import type { RawAddress, ResolvedAddress } from "./types.ts";

export async function resolveAddress(
  raw: RawAddress,
  cwdPath: string,
  context: ClaudeCodeContext,
): Promise<ResolvedAddress> {
  const pathInput = raw.pathInput ?? cwdPath;

  if (pathInput === "/") return { type: "all" };

  const isJsonl = pathInput.endsWith(".jsonl");
  let projectPath: string;
  let projectDir: string;
  let chatPath: string | undefined;

  if (isJsonl) {
    projectPath = dirname(pathInput);
    projectDir = dirname(pathInput);
    chatPath = pathInput;
  } else {
    projectPath = pathInput === "." ? cwdPath : pathInput;
    const dir = await findProjectDir(context, projectPath);
    if (!dir) throw new Error(`Project not found: ${projectPath}`);
    projectDir = dir;
  }

  if (!raw.chatInput && !isJsonl) {
    return { type: "project", projectPath, projectDir };
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
  const range = parseRange(raw.messagesInput);

  if (range) {
    const startMessage = resolveMessage(chat.messages, range.start);
    const endMessage = resolveMessage(chat.messages, range.end);
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

  const message = resolveMessage(chat.messages, raw.messagesInput);
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
