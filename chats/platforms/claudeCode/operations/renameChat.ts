import { appendTitle } from "../data/storage.ts";

export async function renameChat(
  chatPath: string,
  newTitle: string,
): Promise<void> {
  await appendTitle(chatPath, newTitle);
}
