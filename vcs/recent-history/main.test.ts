import { dir } from "@cross/dir";
import { join, resolve } from "@std/path";
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import {
  filterAndFormat,
  parseIsoTimestamp,
  resolveVcs,
  VCS_SUPPORT,
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

  test("renders full example with elision — bare rows, no header, no indent", () => {
    const out = filterAndFormat(SAMPLE_OPS, "jj", null, 3);
    expect(out).not.toContain("Recent");
    expect(out).toContain("2026-08-01T14:22:10  d2ae7c44  jj squash --into @-");
    expect(out).not.toContain(
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
    // Row lines start with the timestamp; the elision line, if present, starts
    // with a digit too (the count) — but here we expect no elision.
    const rowLines = out
      .split("\n")
      .filter((line) => /^\d{4}-\d{2}-\d{2}T/.test(line));
    expect(rowLines.length).toBe(SAMPLE_OPS.length);
    expect(out).not.toContain("elided");
  });

  test("compares timestamps as instants, not strings — a jj-style local-time entry ('11:50:07') is correctly recognized as newer than a UTC bound ('15:49:49Z') from the same absolute moment", () => {
    // The walker emits UTC (`…Z`) but jj emits local-time-no-offset. String
    // comparison would put "11:…" < "15:…" and hide the op. Instant compare
    // resolves both to the same wall clock and shows it.
    const localOps: HistoryEntry[] = [
      {
        timestamp: "2026-08-02T11:50:07-04:00",
        line: "cca6c894  create bookmark probe2",
      },
    ];
    const out = filterAndFormat(localOps, "jj", "2026-08-02T15:49:49.216Z", 3);
    expect(out).toContain("cca6c894");
  });

  test("git swaps the elision-line command reference", () => {
    const out = filterAndFormat(SAMPLE_OPS, "git", null, 1);
    expect(out).not.toContain("Recent");
    expect(out).toContain("run `git reflog` to see more.");
  });
});

// -- End-to-end via shim --

describe("shim end-to-end", () => {
  test("silent when cwd is not a repo", async () => {
    const dir = await tmp("vcs-none-");
    const res = spawnSync(SHIM, [], {
      cwd: dir,
      encoding: "utf8",
    });
    expect(res.status).toBe(0);
    expect(res.stdout).toBe("");
  });

  test("silent when no ops exceed a future --since", async () => {
    const dir = await makeJjRepo();
    const res = spawnSync(SHIM, ["--since=2999-01-01T00:00:00"], {
      cwd: dir,
      encoding: "utf8",
    });
    expect(res.status).toBe(0);
    expect(res.stdout).toBe("");
  });

  test("emits output in a fresh jj repo", async () => {
    const dir = await makeJjRepo();
    const res = spawnSync(SHIM, ["--limit=3"], {
      cwd: dir,
      encoding: "utf8",
    });
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/^\d{4}-\d{2}-\d{2}T/m);
  });

  test("emits output in a git repo", async () => {
    const dir = await makeGitRepo();
    const res = spawnSync(SHIM, ["--limit=3"], {
      cwd: dir,
      encoding: "utf8",
    });
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/^\d{4}-\d{2}-\d{2}T/m);
  });

  test("--vcs=jj errors when cwd is not inside a jj workspace", async () => {
    const dir = await makeGitRepo();
    const res = spawnSync(SHIM, ["--vcs=jj"], {
      cwd: dir,
      encoding: "utf8",
    });
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain("--vcs=jj");
    expect(res.stderr).toContain("jj workspace");
  });

  test("--vcs=git errors when cwd is not inside a git repository", async () => {
    const dir = await tmp("vcs-nogit-");
    const res = spawnSync(SHIM, ["--vcs=git"], {
      cwd: dir,
      encoding: "utf8",
    });
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain("--vcs=git");
    expect(res.stderr).toContain("git repository");
  });

  test("--vcs=git works in a co-located jj+git repo", async () => {
    const dir = await makeJjRepo();
    const res = spawnSync(SHIM, ["--vcs=git", "--limit=1"], {
      cwd: dir,
      encoding: "utf8",
    });
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/^\d{4}-\d{2}-\d{2}T/m);
  });

  test("--vcs=jj works when .jj is present", async () => {
    const dir = await makeJjRepo();
    const res = spawnSync(SHIM, ["--vcs=jj", "--limit=1"], {
      cwd: dir,
      encoding: "utf8",
    });
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/^\d{4}-\d{2}-\d{2}T/m);
  });
});
