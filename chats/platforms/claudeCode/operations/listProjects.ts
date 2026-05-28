import type { ClaudeCodeContext } from "../data/storage.ts";
import { listChats, listProjectDirs } from "../data/storage.ts";

export async function listProjects(
  context: ClaudeCodeContext,
): Promise<{ dir: string; encoded: string; chatCount: number }[]> {
  const projects = await listProjectDirs(context);
  return Promise.all(
    projects.map(async (project) => ({
      dir: project.dir,
      encoded: project.encoded,
      chatCount: (await listChats(project.dir)).length,
    })),
  );
}
