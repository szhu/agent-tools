import { cwd } from "node:process";
import type { RawAddress } from "../identifiers/types.ts";
import { appendTitle, resolveAddress } from "../platforms/claudeCode.ts";

export async function runRename(
  raw: RawAddress,
  newTitle: string,
): Promise<void> {
  const resolved = await resolveAddress(raw, cwd());
  if (resolved.type !== "chat") throw new Error("Chat ID required");
  await appendTitle(resolved.jsonlPath, newTitle);
  console.log(`Renamed ${resolved.chatId.slice(0, 8)} → "${newTitle}"`);
}
