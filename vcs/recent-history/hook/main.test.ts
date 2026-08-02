import { dir } from "@cross/dir";
import { join, resolve } from "@std/path";
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { appendIndex, readIndex } from "./index.ts";
import { parseHookInput } from "./input.ts";
import { HOOK_MARKER, installHooks, uninstallHooks } from "./install.ts";
import { findPreviousFireTimestamp } from "./transcript.ts";

const HOOK_SHIM = resolve(
  import.meta.dir,
  "..",
  "..",
  "..",
  "bin",
  "vcs-recent-history-hook",
);

async function makeJjRepo(): Promise<string> {
  const d = await mkdtemp(join(await dir("tmp"), "vcs-e2e-"));
  spawnSync("jj", ["git", "init"], { cwd: d });
  spawnSync("jj", ["describe", "-m", "one"], { cwd: d });
  spawnSync("jj", ["new", "-m", "two"], { cwd: d });
  return d;
}

async function writeTranscript(lines: object[]): Promise<string> {
  const d = await mkdtemp(join(await dir("tmp"), "vcs-transcript-"));
  const path = join(d, "t.jsonl");
  await writeFile(path, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  return path;
}

describe("parseHookInput", () => {
  test("UserPromptSubmit shape", () => {
    const raw = JSON.stringify({
      hook_event_name: "UserPromptSubmit",
      session_id: "s1",
      transcript_path: "/tmp/t.jsonl",
      prompt_id: "p1",
    });
    const result = parseHookInput(raw);
    expect(result.hook_event_name).toBe("UserPromptSubmit");
    expect(result.prompt_id).toBe("p1");
    expect(result.tool_use_id).toBeUndefined();
  });

  test("PostToolUse shape with duration", () => {
    const raw = JSON.stringify({
      hook_event_name: "PostToolUse",
      session_id: "s1",
      transcript_path: "/tmp/t.jsonl",
      prompt_id: "p1",
      tool_use_id: "toolu_1",
      duration_ms: 42,
    });
    const result = parseHookInput(raw);
    expect(result.hook_event_name).toBe("PostToolUse");
    expect(result.tool_use_id).toBe("toolu_1");
    expect(result.duration_ms).toBe(42);
  });

  test("rejects unrecognized event", () => {
    const raw = JSON.stringify({
      hook_event_name: "Stop",
      session_id: "s1",
      transcript_path: "/tmp/t.jsonl",
      prompt_id: "p1",
    });
    expect(() => parseHookInput(raw)).toThrow(/unsupported/);
  });
});

describe("findPreviousFireTimestamp", () => {
  test("returns null when index is empty", async () => {
    const path = await writeTranscript([
      {
        type: "user",
        uuid: "u1",
        parentUuid: null,
        promptId: "p1",
        timestamp: "2026-08-01T10:00:00Z",
      },
      { type: "last-prompt", leafUuid: "u1" },
    ]);
    expect(
      findPreviousFireTimestamp({
        transcriptPath: path,
        index: new Map(),
      }),
    ).toBeNull();
  });

  test("finds a promptId ancestor", async () => {
    const path = await writeTranscript([
      {
        type: "user",
        uuid: "u1",
        parentUuid: null,
        promptId: "p1",
        timestamp: "2026-08-01T10:00:00Z",
      },
      {
        type: "assistant",
        uuid: "u2",
        parentUuid: "u1",
        timestamp: "2026-08-01T10:00:10Z",
        message: { content: [] },
      },
      {
        type: "user",
        uuid: "u3",
        parentUuid: "u2",
        promptId: "p2",
        timestamp: "2026-08-01T10:00:20Z",
      },
      { type: "last-prompt", leafUuid: "u3" },
    ]);
    const index = new Map<string, string>([["p1", "2026-08-01T10:00:00.500Z"]]);
    const result = findPreviousFireTimestamp({
      transcriptPath: path,
      index,
    });
    expect(result).toBe("2026-08-01T10:00:00.500Z");
  });

  test("finds a tool_use.id ancestor", async () => {
    const path = await writeTranscript([
      {
        type: "user",
        uuid: "u1",
        parentUuid: null,
        promptId: "p1",
        timestamp: "2026-08-01T10:00:00Z",
      },
      {
        type: "assistant",
        uuid: "u2",
        parentUuid: "u1",
        timestamp: "2026-08-01T10:00:10Z",
        message: {
          content: [
            { type: "tool_use", id: "toolu_A", name: "Bash", input: {} },
          ],
        },
      },
      { type: "last-prompt", leafUuid: "u2" },
    ]);
    const index = new Map<string, string>([
      ["toolu_A", "2026-08-01T10:00:10.100Z"],
    ]);
    const result = findPreviousFireTimestamp({
      transcriptPath: path,
      index,
    });
    expect(result).toBe("2026-08-01T10:00:10.100Z");
  });

  test("returns a hit even when the ancestor id matches the current fire's id — walker does not self-exclude, and correctness depends on the caller writing to the index AFTER this returns", async () => {
    // Scenario: PostToolUse for toolu_A. Its own tool_use.id is in the transcript
    // (as an assistant tool_use ancestor). PreToolUse for the SAME toolu_A already
    // fired earlier and wrote {toolu_A: T_pre} to the index. Walker must return
    // T_pre — that's the previous hook fire's timestamp.
    //
    // This test would fail if:
    //   (a) The walker self-excluded by raw id (would skip toolu_A and return null).
    //   (b) The caller wrote the current fire's id to the index BEFORE calling this
    //       function (walker would see the current fire's fresh writeback instead
    //       of the prior fire's, and return current time).
    const path = await writeTranscript([
      {
        type: "user",
        uuid: "u1",
        parentUuid: null,
        promptId: "p1",
        timestamp: "2026-08-01T10:00:00Z",
      },
      {
        type: "assistant",
        uuid: "u2",
        parentUuid: "u1",
        timestamp: "2026-08-01T10:00:05Z",
        message: {
          content: [
            { type: "tool_use", id: "toolu_A", name: "Bash", input: {} },
          ],
        },
      },
      { type: "last-prompt", leafUuid: "u2" },
    ]);
    const index = new Map<string, string>([
      ["toolu_A", "2026-08-01T10:00:05.500Z"], // PreToolUse's write
    ]);
    const result = findPreviousFireTimestamp({
      transcriptPath: path,
      index,
    });
    expect(result).toBe("2026-08-01T10:00:05.500Z");
  });

  test("stops at the first ancestor hit even if older ones also match", async () => {
    const path = await writeTranscript([
      {
        type: "user",
        uuid: "u1",
        parentUuid: null,
        promptId: "p1",
        timestamp: "2026-08-01T10:00:00Z",
      },
      {
        type: "user",
        uuid: "u2",
        parentUuid: "u1",
        promptId: "p2",
        timestamp: "2026-08-01T10:00:10Z",
      },
      { type: "last-prompt", leafUuid: "u2" },
    ]);
    const index = new Map<string, string>([
      ["p1", "T-old"],
      ["p2", "T-new"],
    ]);
    expect(
      findPreviousFireTimestamp({
        transcriptPath: path,
        index,
      }),
    ).toBe("T-new");
  });

  test("returns null when the transcript file doesn't exist yet — fresh sessions fire UserPromptSubmit before Claude Code has written any transcript", () => {
    expect(
      findPreviousFireTimestamp({
        transcriptPath: "/tmp/does-not-exist-vcs-hook.jsonl",
        index: new Map(),
      }),
    ).toBeNull();
  });
});

describe("hook index", () => {
  test("reads an empty/missing file as empty map", async () => {
    const d = await mkdtemp(join(await dir("tmp"), "vcs-idx-"));
    expect(readIndex(join(d, "no.jsonl")).size).toBe(0);
  });

  test("append then read round-trips", async () => {
    const d = await mkdtemp(join(await dir("tmp"), "vcs-idx-"));
    const path = join(d, "i.jsonl");
    appendIndex(path, "id1", "2026-08-01T10:00:00Z");
    appendIndex(path, "id2", "2026-08-01T10:00:10Z");
    const map = readIndex(path);
    expect(map.get("id1")).toBe("2026-08-01T10:00:00Z");
    expect(map.get("id2")).toBe("2026-08-01T10:00:10Z");
    expect(map.size).toBe(2);
  });

  test("rotates when line count exceeds cap * 1.5", async () => {
    const d = await mkdtemp(join(await dir("tmp"), "vcs-idx-"));
    const path = join(d, "i.jsonl");
    for (let i = 0; i < 200; i++) {
      appendIndex(path, `id${i}`, `T${i}`, 100);
    }
    const contents = await readFile(path, "utf8");
    const lines = contents.trim().split("\n");
    expect(lines.length).toBeLessThanOrEqual(150);
    expect(lines.length).toBeGreaterThanOrEqual(100);
    const map = readIndex(path);
    expect(map.get("id199")).toBe("T199");
  });
});

test("UserPromptSubmit fire in a jj repo emits a jj operations notification", async () => {
  const repo = await makeJjRepo();
  const indexDir = await mkdtemp(join(await dir("tmp"), "vcs-idx-"));
  const tPath = join(indexDir, "transcript.jsonl");
  await writeFile(
    tPath,
    [
      JSON.stringify({
        type: "user",
        uuid: "u1",
        parentUuid: null,
        promptId: "p1",
        timestamp: "2026-08-01T10:00:00Z",
      }),
      JSON.stringify({ type: "last-prompt", leafUuid: "u1" }),
    ].join("\n") + "\n",
  );

  const payload = JSON.stringify({
    hook_event_name: "UserPromptSubmit",
    session_id: "s1",
    transcript_path: tPath,
    prompt_id: "p_new",
  });

  const res = spawnSync(HOOK_SHIM, ["--limit=3"], {
    cwd: repo,
    input: payload,
    encoding: "utf8",
    env: {
      ...process.env,
      VCS_RECENT_HISTORY_HOOK_INDEX: join(indexDir, "index.jsonl"),
    },
  });
  expect(res.status).toBe(0);
  expect(res.stdout).toContain("JJ operations");
});

test("PostToolUse below 300ms emits no disclaimer", async () => {
  const repo = await makeJjRepo();
  const indexDir = await mkdtemp(join(await dir("tmp"), "vcs-idx-"));
  const tPath = join(indexDir, "transcript.jsonl");
  await writeFile(
    tPath,
    [
      JSON.stringify({
        type: "user",
        uuid: "u1",
        parentUuid: null,
        promptId: "p1",
        timestamp: "2026-08-01T10:00:00Z",
      }),
      JSON.stringify({ type: "last-prompt", leafUuid: "u1" }),
    ].join("\n") + "\n",
  );
  const payload = JSON.stringify({
    hook_event_name: "PostToolUse",
    session_id: "s1",
    transcript_path: tPath,
    prompt_id: "p1",
    tool_use_id: "toolu_A",
    duration_ms: 100,
  });
  const res = spawnSync(HOOK_SHIM, ["--limit=3"], {
    cwd: repo,
    input: payload,
    encoding: "utf8",
    env: {
      ...process.env,
      VCS_RECENT_HISTORY_HOOK_INDEX: join(indexDir, "index.jsonl"),
    },
  });
  expect(res.status).toBe(0);
  expect(res.stdout).not.toContain("double checking");
});

test("PostToolUse above 300ms emits disclaimer", async () => {
  const repo = await makeJjRepo();
  const indexDir = await mkdtemp(join(await dir("tmp"), "vcs-idx-"));
  const tPath = join(indexDir, "transcript.jsonl");
  await writeFile(
    tPath,
    [
      JSON.stringify({
        type: "user",
        uuid: "u1",
        parentUuid: null,
        promptId: "p1",
        timestamp: "2026-08-01T10:00:00Z",
      }),
      JSON.stringify({ type: "last-prompt", leafUuid: "u1" }),
    ].join("\n") + "\n",
  );
  // Pre-seed the index so the walker finds a prior fire (p1) via the
  // transcript's promptId. Without this we'd land in the baseline branch,
  // which suppresses the disclaimer.
  const indexPath = join(indexDir, "index.jsonl");
  await writeFile(
    indexPath,
    JSON.stringify({ id: "p1", ts: "2000-01-01T00:00:00Z" }) + "\n",
  );
  const payload = JSON.stringify({
    hook_event_name: "PostToolUse",
    session_id: "s1",
    transcript_path: tPath,
    prompt_id: "p1",
    tool_use_id: "toolu_A",
    duration_ms: 5000,
  });
  const res = spawnSync(HOOK_SHIM, ["--limit=3"], {
    cwd: repo,
    input: payload,
    encoding: "utf8",
    env: {
      ...process.env,
      VCS_RECENT_HISTORY_HOOK_INDEX: indexPath,
    },
  });
  expect(res.status).toBe(0);
  expect(res.stdout).toContain("double checking");
  expect(res.stdout).toContain("additionalContext");
  expect(res.stdout).toContain("(5.0s)");
});

describe("install / uninstall", () => {
  test("install writes three events with the marker", async () => {
    const configDir = await mkdtemp(join(await dir("tmp"), "vcs-inst-"));
    installHooks({ configDir, scriptAbsPath: "/abs/hook", limit: 3 });
    const settings = JSON.parse(
      await readFile(join(configDir, "settings.json"), "utf8"),
    );
    for (const event of ["UserPromptSubmit", "PreToolUse", "PostToolUse"]) {
      const s = JSON.stringify(settings.hooks[event]);
      expect(s).toContain("/abs/hook");
      expect(s).toContain(HOOK_MARKER);
      expect(s).toContain("--limit=3");
    }
  });

  test("uninstall removes only entries with our marker", async () => {
    const configDir = await mkdtemp(join(await dir("tmp"), "vcs-inst-"));
    await writeFile(
      join(configDir, "settings.json"),
      JSON.stringify({
        hooks: {
          UserPromptSubmit: [
            { hooks: [{ type: "command", command: "unrelated-command" }] },
          ],
        },
      }),
    );
    installHooks({ configDir, scriptAbsPath: "/abs/hook", limit: 3 });
    uninstallHooks({ configDir });
    const settings = JSON.parse(
      await readFile(join(configDir, "settings.json"), "utf8"),
    );
    const remaining = JSON.stringify(settings.hooks.UserPromptSubmit);
    expect(remaining).toContain("unrelated-command");
    expect(remaining).not.toContain(HOOK_MARKER);
  });

  test("install is idempotent", async () => {
    const configDir = await mkdtemp(join(await dir("tmp"), "vcs-inst-"));
    installHooks({ configDir, scriptAbsPath: "/abs/hook", limit: 3 });
    installHooks({ configDir, scriptAbsPath: "/abs/hook", limit: 3 });
    const settings = JSON.parse(
      await readFile(join(configDir, "settings.json"), "utf8"),
    );
    for (const event of ["UserPromptSubmit", "PreToolUse", "PostToolUse"]) {
      const entries = settings.hooks[event] as unknown[];
      const withMarker = entries.filter((e) =>
        JSON.stringify(e).includes(HOOK_MARKER),
      );
      expect(withMarker.length).toBe(1);
    }
  });
});
