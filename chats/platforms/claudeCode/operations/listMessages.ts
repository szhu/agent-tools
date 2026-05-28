import { loadChat } from "../data/storage.ts";
import type { ClaudeCodeChat, ClaudeCodeMessage } from "../data/types.ts";

export async function listMessages(
  chatPath: string,
): Promise<{ chat: ClaudeCodeChat; messages: ClaudeCodeMessage[] }> {
  const chat = await loadChat(chatPath);
  const messages = chat.messages.filter((m) => m.uuid);
  return { chat, messages };
}
