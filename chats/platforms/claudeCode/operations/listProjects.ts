import type { ClaudeCodeContext } from "../data/storage.ts";
import { listAllProjects, listChats } from "../data/storage.ts";

export async function listProjects(
  context: ClaudeCodeContext,
): Promise<{ encoded: string; chatCount: number }[]> {
  const projects = await listAllProjects(context);
  return Promise.all(
    projects.map(async (project) => ({
      encoded: project.encoded,
      chatCount: (await listChats(project.dir)).length,
    })),
  );
}
