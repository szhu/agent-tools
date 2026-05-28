import { cwd } from "node:process";
import type { ClaudeCodeContext } from "../data/storage.ts";
import { resolveAddress } from "../identifiers/resolve.ts";
import type { RawAddress } from "../identifiers/types.ts";
import { moveChat } from "../operations/moveMessages.ts";

export async function runMv(
  context: ClaudeCodeContext,
  src: RawAddress,
  dest: RawAddress,
): Promise<void> {
  const cwdPath = cwd();
  const resolvedSrc = await resolveAddress(src, cwdPath, context);
  const resolvedDest = await resolveAddress(dest, cwdPath, context);

  if (resolvedSrc.type === "messages") {
    // Moving message ranges requires rewriting parentUuid links in the JSONL
    // — skipping for now, whole-chat moves cover 95% of real use cases
    throw new Error(
      "Message-range moves not yet implemented. Move entire chats for now.",
    );
  }
  if (resolvedSrc.type !== "chat") throw new Error("Source must be a chat");
  if (resolvedDest.type !== "project")
    throw new Error("Destination must be a project");

  await moveChat(resolvedSrc.chatPath, resolvedDest.projectDir);
  console.log(
    `Moved ${resolvedSrc.chatId.slice(0, 8)} → ${resolvedDest.projectDir}`,
  );
}
