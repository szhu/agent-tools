import { cwd } from "node:process";
import type { Address } from "../identifiers/types.ts";
import {
  findProjectDir,
  listChats,
  moveChatFile,
  resolveChat,
} from "../platforms/claudeCode.ts";

async function resolveProjectDir(addr: Address): Promise<string> {
  const p = addr.projectPath ?? cwd();
  const dir = await findProjectDir(p === "." ? cwd() : p);
  if (!dir) throw new Error(`Project not found: ${p}`);
  return dir;
}

export async function runMv(src: Address, dest: Address): Promise<void> {
  if (src.range || src.messageId) {
    // Moving message ranges requires rewriting parentUuid links in the JSONL
    // — skipping for now, whole-chat moves cover 95% of real use cases
    throw new Error(
      "Message-range moves not yet implemented. Move entire chats for now.",
    );
  }

  const srcDir = await resolveProjectDir(src);
  const destDir = await resolveProjectDir(dest);

  if (!src.chatId) throw new Error("Source chat ID required");

  const chats = await listChats(srcDir);
  const chat = resolveChat(chats, src.chatId);
  await moveChatFile(chat.filePath, destDir);
  console.log(`Moved ${chat.id.slice(0, 8)} → ${destDir}`);
}
