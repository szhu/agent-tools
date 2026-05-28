import { basename } from "@std/path";
import { appendChatEntry } from "../data/storage.ts";

export async function renameChat(
  chatPath: string,
  newTitle: string,
): Promise<void> {
  const sessionId = basename(chatPath, ".jsonl");
  await appendChatEntry(chatPath, {
    type: "custom-title",
    customTitle: newTitle,
    sessionId,
  });
}
