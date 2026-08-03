/**
 * End-to-end validation of the vcs-recent-history hook via a real `claude -p`
 * session. Asserts directly on `hook_response` events from the stream-json
 * output — no model self-report, so no hallucination surface.
 *
 * Covers UserPromptSubmit, PreToolUse, PostToolUse. PreToolUse uses a
 * delayed-nc listener helper: the trigger Bash returns immediately, then the
 * listener creates a jj op ~150 ms later — landing between the trigger Bash's
 * PostToolUse fire and the next Bash's PreToolUse fire, i.e. in the window a
 * Pre would surface.
 *
 * Off by default: takes 30 s+ and spawns the `claude` CLI. Enable with
 * `TEST_E2E=1 bun test`.
 */

import { dir } from "@cross/dir";
import { join, resolve } from "@std/path";
import { describe, expect, test } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";

const E2E = process.env["TEST_E2E"] === "1";
const HOOK_BIN = resolve(
  import.meta.dir,
  "..",
  "..",
  "..",
  "bin",
  "vcs-recent-history-hook",
);
// `claude` lives in ~/.bun/bin, which isn't always on PATH under `bun test`.
// Override via CLAUDE_BIN if it's somewhere else.
const CLAUDE_BIN =
  process.env["CLAUDE_BIN"] ??
  join(process.env["HOME"] ?? "", ".bun", "bin", "claude");

/**
 * Deterministic scratch CLAUDE_CONFIG_DIR path — kebab of this test script's
 * absolute path, rooted at /tmp. Stable across runs so the per-config-dir
 * keychain entry created by `/login` persists.
 *
 * First-time setup on a machine: run
 *   `CLAUDE_CONFIG_DIR=<returned path> claude /login`
 * once. After that, subsequent test runs auth automatically.
 */
function scratchClaudeConfigDir(): string {
  // Matches claude's own convention for `~/.claude/projects/` dir names:
  // `/`, `.`, `_` collapse to `-`.
  return `/tmp/${import.meta.path.replace(/[/._]/g, "-")}`;
}

/**
 * Idempotent: just creates the scratch cfg dir. Empty by design — nothing
 * from real ~/.claude/ is copied or linked in, so user's plugins, CLAUDE.md,
 * agents, skills, hooks, etc. don't leak into the test. `--settings` inline
 * contributes the only hooks; auth comes from the per-config-dir keychain
 * entry created by a one-time `claude auth login` at this path.
 */
function ensureScratchClaudeCfg(): string {
  const cfg = scratchClaudeConfigDir();
  mkdirSync(cfg, { recursive: true });
  return cfg;
}

interface HookResponseEvent {
  type: "system";
  subtype: "hook_response";
  hook_event: "UserPromptSubmit" | "PreToolUse" | "PostToolUse" | string;
  hook_name?: string;
  output: string;
  stdout: string;
  stderr: string;
  exit_code: number;
}

async function makeScratchJjRepo(): Promise<string> {
  const d = await mkdtemp(join(await dir("tmp"), "vcs-e2e-repo-"));
  const opts = { cwd: d };
  spawnSync("jj", ["git", "init"], opts);
  spawnSync("jj", ["describe", "-m", "init"], opts);
  spawnSync("jj", ["new", "-m", "wip"], opts);
  return d;
}

/**
 * Listens on an ephemeral port; on the first connection, waits `delayMs`,
 * then runs `jj bookmark create <bookmarkName> -r @` in `cwd`. Returns the
 * chosen port and a stop() function.
 *
 * The delay is the whole point: the trigger Bash tool call returns as soon
 * as its `nc` client closes the connection, so the op fires during the
 * "no tool call active" window that follows — exactly where the next Bash's
 * PreToolUse expects to find it.
 */
async function startDelayedOpListener(opts: {
  cwd: string;
  delayMs: number;
  bookmarkName: string;
}): Promise<{ port: number; stop: () => Promise<void> }> {
  return new Promise((resolveStart) => {
    let done = false;
    const server: Server = createServer((sock: Socket) => {
      if (done) {
        sock.end();
        return;
      }
      done = true;
      // Delegate the delay + jj call to a detached shell so it doesn't
      // depend on Node's event loop — the test spawns claude via
      // spawnSync, which blocks the loop and would starve any setTimeout
      // scheduled here.
      const delaySec = (opts.delayMs / 1000).toFixed(3);
      const shellCmd = `sleep ${delaySec} && jj bookmark create ${opts.bookmarkName} -r @`;
      const child = spawn("sh", ["-c", shellCmd], {
        cwd: opts.cwd,
        detached: true,
        stdio: "ignore",
      });
      child.unref();
      sock.end();
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolveStart({
        port,
        stop: () =>
          new Promise((r) => {
            server.close(() => r());
          }),
      });
    });
  });
}

/**
 * Spawns `claude -p` with the hook wired in for all three events via
 * `--settings`, streams JSON output back with `--include-hook-events`, and
 * collects every `hook_response` event.
 */
async function runClaudeCollectHookEvents(opts: {
  prompt: string;
  cwd: string;
  timeoutMs?: number;
}): Promise<HookResponseEvent[]> {
  const hookCommand = `${HOOK_BIN} --limit=3`;
  const settings = {
    hooks: {
      UserPromptSubmit: [
        { hooks: [{ type: "command", command: hookCommand }] },
      ],
      PreToolUse: [{ hooks: [{ type: "command", command: hookCommand }] }],
      PostToolUse: [{ hooks: [{ type: "command", command: hookCommand }] }],
    },
  };
  // Async spawn — keeps Node's event loop unblocked so any in-process
  // helpers (e.g. the delayed-op listener used by the Pre test) can service
  // socket events while claude runs. Point CLAUDE_CONFIG_DIR at our scratch
  // cfg so user's own hooks (statusbar/sound/etc.) don't fire — only the
  // hook we inject via --settings does.
  const cfgDir = ensureScratchClaudeCfg();
  const child = spawn(
    CLAUDE_BIN,
    [
      "-p",
      "--model",
      "claude-haiku-4-5",
      "--output-format",
      "stream-json",
      "--include-hook-events",
      "--verbose",
      "--permission-mode",
      "bypassPermissions",
      "--settings",
      JSON.stringify(settings),
      opts.prompt,
    ],
    {
      cwd: opts.cwd,
      env: { ...process.env, CLAUDE_CONFIG_DIR: cfgDir },
    },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  const timeoutMs = opts.timeoutMs ?? 90_000;
  await new Promise<void>((resolveExit, rejectExit) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      rejectExit(new Error(`claude timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.on("close", () => {
      clearTimeout(timer);
      resolveExit();
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      rejectExit(e);
    });
  });
  // Auth-failure surface: `claude -p` prints "Not logged in" and exits ~0
  // when the scratch cfg dir doesn't have a keychain entry yet. Detect that
  // and throw with the exact one-time-setup command, so a fresh dev checkout
  // doesn't get a cryptic `withTag: undefined` failure.
  if (/Not logged in/i.test(stdout) || /Not logged in/i.test(stderr)) {
    throw new Error(
      `claude -p reported "Not logged in" for scratch CLAUDE_CONFIG_DIR.\n` +
        `\n` +
        `One-time setup — run this in your terminal:\n` +
        `\n` +
        `  CLAUDE_CONFIG_DIR=${cfgDir} claude auth login\n` +
        `\n` +
        `After the login persists in your Keychain, this test will auth automatically on every future run.`,
    );
  }
  const events: HookResponseEvent[] = [];
  for (const line of stdout.split("\n")) {
    if (!line) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const e = parsed as { type?: string; subtype?: string };
    if (e.type === "system" && e.subtype === "hook_response") {
      events.push(parsed as HookResponseEvent);
    }
  }
  return events;
}

/**
 * Extracts the human-visible additionalContext from a hook_response event.
 * UserPromptSubmit writes the body raw; Pre/Post wrap it in a JSON envelope.
 * The hook can also be silent (empty body); returns "" in that case.
 */
function additionalContext(event: HookResponseEvent): string {
  const out = event.output ?? "";
  if (out === "") return "";
  if (event.hook_event === "UserPromptSubmit") return out;
  try {
    const parsed = JSON.parse(out) as {
      hookSpecificOutput?: { additionalContext?: string };
    };
    return parsed.hookSpecificOutput?.additionalContext ?? "";
  } catch {
    return "";
  }
}

/**
 * Filters hook_response events to those coming from OUR hook, i.e. whose
 * additionalContext is non-empty AND contains the "JJ operations" phrase we
 * emit. Other hooks (statusbar, sound, etc.) also produce hook_response
 * events; skipping them keeps assertions from tripping over unrelated
 * envelopes.
 */
function ourEvents(events: HookResponseEvent[]): HookResponseEvent[] {
  return events.filter((event) => {
    const context = additionalContext(event);
    return context.length > 0 && context.includes("JJ ");
  });
}

describe.skipIf(!E2E)("hook e2e via claude -p", () => {
  test("PostToolUse surfaces a jj op created inside its own tool call", async () => {
    const repo = await makeScratchJjRepo();
    const tag = `post_${Date.now()}`;
    const events = await runClaudeCollectHookEvents({
      prompt: `Run exactly one Bash tool call: \`jj bookmark create ${tag} -r @\`. Then reply exactly: done.`,
      cwd: repo,
    });
    const posts = ourEvents(events).filter(
      (e) => e.hook_event === "PostToolUse",
    );
    const withTag = posts.find((e) =>
      additionalContext(e).includes(`jj bookmark create ${tag}`),
    );
    expect(withTag).toBeDefined();
    const context = additionalContext(withTag!);
    expect(context).toContain(
      "These JJ operations occurred during your tool call",
    );
  }, 120_000);

  test("UserPromptSubmit baseline surfaces recent ops (pre-invocation op included)", async () => {
    const repo = await makeScratchJjRepo();
    const tag = `ups_${Date.now()}`;
    spawnSync("jj", ["bookmark", "create", tag, "-r", "@"], { cwd: repo });
    const events = await runClaudeCollectHookEvents({
      prompt: `Reply exactly: done. Do not use any tools.`,
      cwd: repo,
    });
    const ups = ourEvents(events).filter(
      (e) => e.hook_event === "UserPromptSubmit",
    );
    const withTag = ups.find((e) => additionalContext(e).includes(tag));
    expect(withTag).toBeDefined();
    const context = additionalContext(withTag!);
    // Fresh session → walker returns null → baseline framing.
    expect(context).toContain("Here are the most recent JJ operations");
  }, 120_000);

  test("PreToolUse surfaces a jj op created between the previous tool call and this one", async () => {
    const repo = await makeScratchJjRepo();
    const tag = `pre_${Date.now()}`;
    const listener = await startDelayedOpListener({
      cwd: repo,
      delayMs: 300,
      bookmarkName: tag,
    });
    try {
      const events = await runClaudeCollectHookEvents({
        prompt:
          `Follow these steps in order, and do NOT combine them into fewer Bash calls:\n` +
          `1. Run Bash: \`nc -w1 127.0.0.1 ${listener.port} </dev/null\`\n` +
          `2. Between the two Bash tool calls, write a short paragraph (at least 4 sentences) explaining what you just did and what you're about to do. This delay is required for the test — do not skip it.\n` +
          `3. Run Bash: \`date\`\n` +
          `4. Reply exactly: done.`,
        cwd: repo,
      });
      const pres = ourEvents(events).filter(
        (e) => e.hook_event === "PreToolUse",
      );
      const withTag = pres.find((e) =>
        additionalContext(e).includes(`jj bookmark create ${tag}`),
      );
      expect(withTag).toBeDefined();
      const context = additionalContext(withTag!);
      expect(context).toContain(
        "occurred since the end of your last tool call",
      );
    } finally {
      await listener.stop();
    }
  }, 120_000);
});
