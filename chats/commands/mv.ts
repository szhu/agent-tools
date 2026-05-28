import { cwd } from "node:process";
import type { RawAddress } from "../identifiers/types.ts";
import {
  moveChatFile,
  resolveAddress,
} from "../platforms/claudeCode.ts";

export async function runMv(src: RawAddress, dest: RawAddress): Promise<void> {
  const cwdPath = cwd();
  const resolvedSrc = await resolveAddress(src, cwdPath);
  const resolvedDest = await resolveAddress(dest, cwdPath);

  if (resolvedSrc.type === "messages") {
    // Moving message ranges requires rewriting parentUuid links in the JSONL
    // — skipping for now, whole-chat moves cover 95% of real use cases
    throw new Error(
      "Message-range moves not yet implemented. Move entire chats for now.",
    );
  }
  if (resolvedSrc.type !== "chat")
    throw new Error("Source must be a chat");
  if (resolvedDest.type !== "project")
    throw new Error("Destination must be a project");

  await moveChatFile(resolvedSrc.jsonlPath, resolvedDest.jsonlDir);
  console.log(`Moved ${resolvedSrc.chatId.slice(0, 8)} → ${resolvedDest.jsonlDir}`);
}
