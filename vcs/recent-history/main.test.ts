import { dir } from "@cross/dir";
import { join, resolve } from "@std/path";
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import {
  filterAndFormat,
  installClaudeCodeGlobal,
  parseIsoTimestamp,
  readSinceFile,
  resolveVcs,
  VCS_SUPPORT,
  writeSinceFile,
  type HistoryEntry,
} from "./main.ts";

const REPO_ROOT = resolve(import.meta.dir, "..", "..");
const SHIM = join(REPO_ROOT, "bin", "vcs-recent-history");

async function tmp(prefix: string): Promise<string> {
  return mkdtemp(join(await dir("tmp"), prefix));
}

async function makeJjRepo(): Promise<string> {
  const dir = await tmp("vcs-jj-");
  const opts = { cwd: dir };
  spawnSync("jj", ["git", "init"], opts);
  spawnSync("jj", ["describe", "-m", "one"], opts);
  spawnSync("jj", ["new", "-m", "two"], opts);
  spawnSync("jj", ["new", "-m", "three"], opts);
  return dir;
}

async function makeGitRepo(): Promise<string> {
  const dir = await tmp("vcs-git-");
  const opts = { cwd: dir };
  spawnSync("git", ["init", "-q", "-b", "main"], opts);
  spawnSync("git", ["config", "user.email", "t@t"], opts);
  spawnSync("git", ["config", "user.name", "t"], opts);
  spawnSync("git", ["config", "commit.gpgsign", "false"], opts);
  await writeFile(join(dir, "a"), "1");
  spawnSync("git", ["add", "."], opts);
  spawnSync("git", ["commit", "-q", "-m", "first"], opts);
  await writeFile(join(dir, "a"), "2");
  spawnSync("git", ["commit", "-q", "-am", "second"], opts);
  return dir;
}

// -- resolveVcs --

describe("resolveVcs", () => {
  test("detect prefers jj in a co-located repo", async () => {
    const dir = await makeJjRepo();
    expect(resolveVcs(dir, "detect")).toBe("jj");
  });
  test("detect returns git in a git-only repo", async () => {
    const dir = await makeGitRepo();
    expect(resolveVcs(dir, "detect")).toBe("git");
  });
  test("detect returns null when cwd is not a repo", async () => {
    const dir = await tmp("vcs-detect-");
    expect(resolveVcs(dir, "detect")).toBeNull();
  });
  test("explicit jj works in a co-located repo", async () => {
    const dir = await makeJjRepo();
    expect(resolveVcs(dir, "jj")).toBe("jj");
  });
  test("explicit git works in a co-located repo", async () => {
    const dir = await makeJjRepo();
    expect(resolveVcs(dir, "git")).toBe("git");
  });
  test("explicit jj returns null in a git-only repo", async () => {
    const dir = await makeGitRepo();
    expect(resolveVcs(dir, "jj")).toBeNull();
  });
  test("detects a repo from a subdirectory", async () => {
    const dir = await makeGitRepo();
    const sub = join(dir, "nested", "deep");
    await mkdir(sub, { recursive: true });
    expect(resolveVcs(sub, "detect")).toBe("git");
  });
});

// -- VCS_SUPPORT.jj.readEntries --

describe("VCS_SUPPORT.jj.readEntries", () => {
  test("returns newest first with iso timestamps and non-empty lines", async () => {
    const dir = await makeJjRepo();
    const entries = VCS_SUPPORT.jj.readEntries(dir);
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      expect(entry.line.length).toBeGreaterThan(0);
    }
    const first = new Date(entries[0]!.timestamp).getTime();
    const last = new Date(entries[entries.length - 1]!.timestamp).getTime();
    expect(first).toBeGreaterThanOrEqual(last);
  });

  test("strips 'args: ' prefix", async () => {
    const dir = await makeJjRepo();
    const entries = VCS_SUPPORT.jj.readEntries(dir);
    for (const entry of entries) {
      // line is now `<opId>  <body>`; the body is what used to be the whole
      // line, and the `args: ` prefix should still be stripped from it.
      const body = entry.line.replace(/^[0-9a-f]+ {2}/, "");
      expect(body.startsWith("args: ")).toBe(false);
    }
  });

  test("prefixes each line with a short op id", async () => {
    const dir = await makeJjRepo();
    const entries = VCS_SUPPORT.jj.readEntries(dir);
    for (const entry of entries) expect(entry.line).toMatch(/^[0-9a-f]+ {2}\S/);
  });
});

// -- VCS_SUPPORT.git.readEntries --

describe("VCS_SUPPORT.git.readEntries", () => {
  test("returns entries with iso timestamps and `<hash>  <subject>` lines", async () => {
    const dir = await makeGitRepo();
    const entries = VCS_SUPPORT.git.readEntries(dir);
    expect(entries.length).toBeGreaterThanOrEqual(2);
    for (const entry of entries) {
      expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      expect(entry.line).toMatch(/^[0-9a-f]+ {2}\S/);
      expect(entry.line).not.toMatch(/HEAD@\{/);
    }
  });
});

// -- parseIsoTimestamp --

describe("parseIsoTimestamp", () => {
  test("accepts basic ISO datetime", () => {
    expect(parseIsoTimestamp("2026-08-01T14:22:10")).toBe(
      "2026-08-01T14:22:10",
    );
  });
  test("accepts ISO datetime with tz offset", () => {
    expect(parseIsoTimestamp("2026-08-01T14:22:10-07:00")).toBe(
      "2026-08-01T14:22:10-07:00",
    );
  });
  test("trims whitespace", () => {
    expect(parseIsoTimestamp("  2026-08-01T14:22:10\n")).toBe(
      "2026-08-01T14:22:10",
    );
  });
  test("rejects garbage", () => {
    expect(parseIsoTimestamp("hello world")).toBeNull();
  });
  test("rejects empty string", () => {
    expect(parseIsoTimestamp("")).toBeNull();
  });
});

// -- readSinceFile --

describe("readSinceFile", () => {
  test("returns null when file is missing", async () => {
    const dir = await tmp("vcs-sf-");
    expect(readSinceFile(join(dir, "nope"))).toBeNull();
  });

  test("accepts valid iso with surrounding whitespace", async () => {
    const dir = await tmp("vcs-sf-");
    const p = join(dir, "s");
    await writeFile(p, "  2026-08-01T14:22:10  \n");
    expect(readSinceFile(p)).toBe("2026-08-01T14:22:10");
  });

  test("accepts iso with timezone offset", async () => {
    const dir = await tmp("vcs-sf-");
    const p = join(dir, "s");
    await writeFile(p, "2026-08-01T14:22:10-07:00");
    expect(readSinceFile(p)).toBe("2026-08-01T14:22:10-07:00");
  });

  test("throws on garbage", async () => {
    const dir = await tmp("vcs-sf-");
    const p = join(dir, "s");
    await writeFile(p, "hello world");
    expect(() => readSinceFile(p)).toThrow(/not a valid ISO-8601 timestamp/);
  });
});

// -- writeSinceFile --

describe("writeSinceFile", () => {
  test("mkdir -p parent and writes timestamp", async () => {
    const dir = await tmp("vcs-sf-");
    const p = join(dir, "a", "b", "c");
    writeSinceFile(p, "2026-08-01T14:22:10");
    const got = await readFile(p, "utf8");
    expect(got.trim()).toBe("2026-08-01T14:22:10");
  });
});

// -- filterAndFormat --

const SAMPLE_OPS: HistoryEntry[] = [
  { timestamp: "2026-08-01T14:22:10", line: "d2ae7c44  jj squash --into @-" },
  { timestamp: "2026-08-01T14:21:55", line: "580c84b0  jj new skwysppt" },
  { timestamp: "2026-08-01T14:21:40", line: 'e12d39f8  jj describe -m "..."' },
  { timestamp: "2026-08-01T14:21:10", line: "ab3c1122  jj new" },
  { timestamp: "2026-08-01T14:21:00", line: "1234abcd  jj new" },
];

describe("filterAndFormat", () => {
  test("empty when nothing above bound", () => {
    expect(filterAndFormat(SAMPLE_OPS, "jj", "2026-08-01T14:22:10", 3)).toBe(
      "",
    );
  });

  test("renders full example with elision", () => {
    const out = filterAndFormat(SAMPLE_OPS, "jj", null, 3);
    expect(out).toContain("Recent JJ ops:");
    expect(out).toContain(
      "  2026-08-01T14:22:10  d2ae7c44  jj squash --into @-",
    );
    expect(out).toContain("2 more elided; run `jj op log` to see more.");
  });

  test("omits elision line when limit not exceeded", () => {
    const out = filterAndFormat(SAMPLE_OPS.slice(0, 2), "jj", null, 3);
    expect(out).not.toContain("elided");
  });

  test("honors null limit", () => {
    const out = filterAndFormat(SAMPLE_OPS, "jj", null, null);
    const listed = out.split("\n").filter((l) => l.startsWith("  "));
    expect(listed.length).toBe(SAMPLE_OPS.length);
    expect(out).not.toContain("elided");
  });

  test("Git label swaps cmd wording", () => {
    const out = filterAndFormat(SAMPLE_OPS, "git", null, 1);
    expect(out).toContain("Recent Git ops:");
    expect(out).toContain("run `git reflog` to see more.");
  });
});

// -- installClaudeCodeGlobal --

describe("installClaudeCodeGlobal", () => {
  test("writes hooks into a fresh settings.json under both events", async () => {
    const dir = await tmp("vcs-install-");
    installClaudeCodeGlobal({
      limit: 3,
      configDir: dir,
      scriptAbsPath: "/abs/bin/vcs-recent-history",
    });
    const settings = JSON.parse(
      await readFile(join(dir, "settings.json"), "utf8"),
    );
    for (const event of ["UserPromptSubmit", "PostToolBatch"]) {
      const s = JSON.stringify(settings.hooks[event]);
      expect(s).toContain("/abs/bin/vcs-recent-history");
      expect(s).toContain("--audience=agent-via-hook");
      expect(s).toContain("jq -r .session_id");
      expect(s).toContain("--since-file=");
      expect(s).toContain("$session_id");
      expect(s).toContain("--limit=3");
    }
    // UserPromptSubmit surfaces raw stdout as context; PostToolBatch must
    // emit the additionalContext JSON envelope, since its raw stdout only
    // goes to logs.
    const userPromptSubmit = JSON.stringify(settings.hooks.UserPromptSubmit);
    expect(userPromptSubmit).not.toContain("additionalContext");
    const postToolBatch = JSON.stringify(settings.hooks.PostToolBatch);
    expect(postToolBatch).toContain("additionalContext");
    expect(postToolBatch).toContain('hookEventName:\\"PostToolBatch\\"');
  });

  test("preserves other top-level keys", async () => {
    const dir = await tmp("vcs-install-");
    await writeFile(
      join(dir, "settings.json"),
      JSON.stringify({ theme: "dark" }),
    );
    installClaudeCodeGlobal({
      limit: 5,
      configDir: dir,
      scriptAbsPath: "/abs/x",
    });
    const settings = JSON.parse(
      await readFile(join(dir, "settings.json"), "utf8"),
    );
    expect(settings.theme).toBe("dark");
  });

  test("is idempotent (no duplicate vcs-recent-history entries on re-run)", async () => {
    const dir = await tmp("vcs-install-");
    for (let i = 0; i < 3; i++) {
      installClaudeCodeGlobal({
        limit: 3,
        configDir: dir,
        scriptAbsPath: "/abs/bin/vcs-recent-history",
      });
    }
    const settings = JSON.parse(
      await readFile(join(dir, "settings.json"), "utf8"),
    );
    for (const event of ["UserPromptSubmit", "PostToolBatch"]) {
      const entries = settings.hooks[event] as unknown[];
      const count = entries.filter((e) =>
        JSON.stringify(e).includes("vcs-recent-history"),
      ).length;
      expect(count).toBe(1);
    }
  });
});

// -- End-to-end via shim --

describe("shim end-to-end", () => {
  test("silent when cwd is not a repo", async () => {
    const dir = await tmp("vcs-none-");
    const res = spawnSync(SHIM, ["--audience=agent-via-hook"], {
      cwd: dir,
      encoding: "utf8",
    });
    expect(res.status).toBe(0);
    expect(res.stdout).toBe("");
  });

  test("silent when no ops exceed a future --since", async () => {
    const dir = await makeJjRepo();
    const res = spawnSync(
      SHIM,
      ["--audience=agent-via-hook", "--since=2999-01-01T00:00:00"],
      { cwd: dir, encoding: "utf8" },
    );
    expect(res.status).toBe(0);
    expect(res.stdout).toBe("");
  });

  test("emits agent-via-hook output in a fresh jj repo", async () => {
    const dir = await makeJjRepo();
    const res = spawnSync(SHIM, ["--audience=agent-via-hook", "--limit=3"], {
      cwd: dir,
      encoding: "utf8",
    });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("Recent JJ ops:");
  });

  test("emits agent-via-hook output in a git repo", async () => {
    const dir = await makeGitRepo();
    const res = spawnSync(SHIM, ["--audience=agent-via-hook", "--limit=3"], {
      cwd: dir,
      encoding: "utf8",
    });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("Recent Git ops:");
  });

  test("since-file round-trip: emits on first run, silent on immediate second run", async () => {
    const dir = await makeJjRepo();
    const sinceFile = join(await tmp("vcs-sf-"), "state");
    const first = spawnSync(
      SHIM,
      ["--audience=agent-via-hook", `--since-file=${sinceFile}`, "--limit=3"],
      { cwd: dir, encoding: "utf8" },
    );
    expect(first.status).toBe(0);
    expect(first.stdout).toContain("Recent JJ ops:");

    const second = spawnSync(
      SHIM,
      ["--audience=agent-via-hook", `--since-file=${sinceFile}`, "--limit=3"],
      { cwd: dir, encoding: "utf8" },
    );
    expect(second.status).toBe(0);
    expect(second.stdout).toBe("");
  });

  test("--audience=human errors 'not implemented yet'", async () => {
    const dir = await tmp("vcs-human-");
    const res = spawnSync(SHIM, ["--audience=human"], {
      cwd: dir,
      encoding: "utf8",
    });
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain("not implemented yet");
  });

  test("--since and --since-file together is an error", async () => {
    const dir = await tmp("vcs-conflict-");
    const res = spawnSync(
      SHIM,
      [
        "--audience=agent-via-hook",
        "--since=2020-01-01T00:00:00",
        `--since-file=${join(dir, "s")}`,
      ],
      { cwd: dir, encoding: "utf8" },
    );
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain("mutually exclusive");
  });

  test("--vcs=jj errors when cwd is not inside a jj workspace", async () => {
    const dir = await makeGitRepo();
    const res = spawnSync(SHIM, ["--audience=agent-via-hook", "--vcs=jj"], {
      cwd: dir,
      encoding: "utf8",
    });
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain("--vcs=jj");
    expect(res.stderr).toContain("jj workspace");
  });

  test("--vcs=git errors when cwd is not inside a git repository", async () => {
    const dir = await tmp("vcs-nogit-");
    const res = spawnSync(SHIM, ["--audience=agent-via-hook", "--vcs=git"], {
      cwd: dir,
      encoding: "utf8",
    });
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain("--vcs=git");
    expect(res.stderr).toContain("git repository");
  });

  test("--vcs=git works in a co-located jj+git repo", async () => {
    const dir = await makeJjRepo();
    const res = spawnSync(
      SHIM,
      ["--audience=agent-via-hook", "--vcs=git", "--limit=1"],
      { cwd: dir, encoding: "utf8" },
    );
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("Recent Git ops:");
  });

  test("--vcs=jj works when .jj is present", async () => {
    const dir = await makeJjRepo();
    const res = spawnSync(
      SHIM,
      ["--audience=agent-via-hook", "--vcs=jj", "--limit=1"],
      { cwd: dir, encoding: "utf8" },
    );
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("Recent JJ ops:");
  });

  test("--since-file with trailing slash fails fast with a clear error", async () => {
    const dir = await makeJjRepo();
    const stateDir = await tmp("vcs-state-trailing-");
    const res = spawnSync(
      SHIM,
      ["--audience=agent-via-hook", `--since-file=${stateDir}/`, "--limit=3"],
      { cwd: dir, encoding: "utf8" },
    );
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain("not a valid file path");
    expect(res.stderr).toContain("Is a variable unset?");
    expect(res.stdout).toBe("");
  });

  test("--install defaults --limit to 3 when none is passed", async () => {
    const configDir = await tmp("vcs-install-default-");
    const res = spawnSync(SHIM, ["--install=claude-code-global"], {
      encoding: "utf8",
      env: { ...process.env, CLAUDE_CONFIG_DIR: configDir },
    });
    expect(res.status).toBe(0);
    const settings = JSON.parse(
      await readFile(join(configDir, "settings.json"), "utf8"),
    );
    for (const event of ["UserPromptSubmit", "PostToolBatch"]) {
      const s = JSON.stringify(settings.hooks[event]);
      expect(s).toContain("--limit=3");
    }
  });

  test("--install writes to CLAUDE_CONFIG_DIR", async () => {
    const configDir = await tmp("vcs-install-e2e-");
    const res = spawnSync(SHIM, ["--install=claude-code-global", "--limit=5"], {
      encoding: "utf8",
      env: { ...process.env, CLAUDE_CONFIG_DIR: configDir },
    });
    expect(res.status).toBe(0);
    const settings = JSON.parse(
      await readFile(join(configDir, "settings.json"), "utf8"),
    );
    for (const event of ["UserPromptSubmit", "PostToolBatch"]) {
      const s = JSON.stringify(settings.hooks[event]);
      expect(s).toContain("vcs-recent-history");
      expect(s).toContain("--limit=5");
      expect(s).toContain(configDir);
      expect(s).toContain("jq -r .session_id");
    }
  });
});
