import { basename, join } from "@std/path";
import { rename } from "node:fs/promises";

export async function moveChat(
  srcChatPath: string,
  destProjectDir: string,
): Promise<void> {
  await rename(srcChatPath, join(destProjectDir, basename(srcChatPath)));
}
