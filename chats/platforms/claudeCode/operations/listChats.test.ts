import { join } from "@std/path";
import { describe, expect, test } from "bun:test";
import { listChats } from "../data/storage.ts";

const fixturesDir = join(import.meta.dirname, "../fixtures/projects");
const alphaDir = join(fixturesDir, "-Users-alice-Code-project-alpha");
const betaDir = join(fixturesDir, "-Users-alice-Code-project-beta");

describe("listChats", () => {
  test("returns chats for alpha project", async () => {
    const chats = await listChats(alphaDir);
    expect(chats.length).toBe(2);
  });

  test("chats have correct ids", async () => {
    const chats = await listChats(alphaDir);
    const ids = chats.map((c) => c.id).sort();
    expect(ids[0]).toBe("aaaaaaaa-1111-0000-0000-000000000000");
    expect(ids[1]).toBe("aaaaaaaa-2222-0000-0000-000000000000");
  });

  test("chats have titles from ai-title entries", async () => {
    const chats = await listChats(alphaDir);
    const byId = Object.fromEntries(chats.map((c) => [c.id, c]));
    expect(byId["aaaaaaaa-1111-0000-0000-000000000000"]?.title).toBe(
      "Getting started with TypeScript",
    );
    expect(byId["aaaaaaaa-2222-0000-0000-000000000000"]?.title).toBe(
      "Debugging async functions",
    );
  });

  test("returns single chat for beta project", async () => {
    const chats = await listChats(betaDir);
    expect(chats.length).toBe(1);
    expect(chats[0]?.id).toBe("bbbbbbbb-1111-0000-0000-000000000000");
  });
});
