import type { ClaudeCodeChat } from "../data/types.ts";
import { listChats as listChatsFromDir } from "../data/storage.ts";

export async function listChats(projectDir: string): Promise<ClaudeCodeChat[]> {
  return listChatsFromDir(projectDir);
}
