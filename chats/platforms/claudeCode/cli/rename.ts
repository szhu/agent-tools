import { cwd } from "node:process";
import type { ClaudeCodeContext } from "../data/storage.ts";
import { resolveAddress } from "../identifiers/resolve.ts";
import type { RawAddress } from "../identifiers/types.ts";
import { renameChat } from "../operations/renameChat.ts";

export async function runRename(
  context: ClaudeCodeContext,
  raw: RawAddress,
  newTitle: string,
): Promise<void> {
  const resolved = await resolveAddress(raw, cwd(), context);
  if (resolved.type !== "chat") throw new Error("Chat ID required");
  await renameChat(resolved.chatPath, newTitle);
  console.log(`Renamed ${resolved.chatId.slice(0, 8)} → "${newTitle}"`);
}
