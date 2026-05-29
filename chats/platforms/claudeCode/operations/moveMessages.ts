import { moveChatFile } from "../data/storage.ts";

export async function moveChat(
  srcChatPath: string,
  destProjectDir: string,
): Promise<void> {
  await moveChatFile(srcChatPath, destProjectDir);
}
