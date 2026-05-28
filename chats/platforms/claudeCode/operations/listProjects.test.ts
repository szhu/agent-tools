import { join } from "@std/path";
import { describe, expect, test } from "bun:test";
import type { ClaudeCodeContext } from "../data/storage.ts";
import { listProjects } from "./listProjects.ts";

const fixturesDir = join(import.meta.dirname, "../fixtures/projects");
const context: ClaudeCodeContext = { projectsDir: fixturesDir };

describe("listProjects", () => {
  test("returns all projects", async () => {
    const projects = await listProjects(context);
    expect(projects.length).toBe(2);
  });

  test("includes dir, encoded names and chat counts", async () => {
    const projects = await listProjects(context);
    const sorted = [...projects].sort((a, b) =>
      a.encoded.localeCompare(b.encoded),
    );
    expect(sorted[0]?.encoded).toBe("-Users-alice-Code-project-alpha");
    expect(sorted[0]?.dir).toBe(join(fixturesDir, "-Users-alice-Code-project-alpha"));
    expect(sorted[0]?.chatCount).toBe(2);
    expect(sorted[1]?.encoded).toBe("-Users-alice-Code-project-beta");
    expect(sorted[1]?.dir).toBe(join(fixturesDir, "-Users-alice-Code-project-beta"));
    expect(sorted[1]?.chatCount).toBe(1);
  });

  test("chat counts are numbers", async () => {
    const projects = await listProjects(context);
    for (const project of projects) {
      expect(typeof project.chatCount).toBe("number");
    }
  });
});
