import { cwd } from "node:process";
import type { Address } from "../identifiers/types.ts";
import {
  appendTitle,
  findProjectDir,
  listChats,
  resolveChat,
} from "../platforms/claudeCode.ts";

export async function runRename(
  addr: Address,
  newTitle: string,
): Promise<void> {
  const projectPath = addr.projectPath ?? cwd();
  const projectDir = await findProjectDir(
    projectPath === "." ? cwd() : projectPath,
  );
  if (!projectDir) throw new Error(`Project not found: ${projectPath}`);
  if (!addr.chatId) throw new Error("Chat ID required");

  const chats = await listChats(projectDir);
  const chat = resolveChat(chats, addr.chatId);
  await appendTitle(chat.filePath, newTitle);
  console.log(`Renamed ${chat.id.slice(0, 8)} → "${newTitle}"`);
}
