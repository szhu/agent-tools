import { ArgsParser, args, exit } from "@cross/utils";
import { dirname, join } from "@std/path";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

// -- VCS resolution --

type Vcs = "jj" | "git";

export interface Op {
  timestamp: string;
  line: string;
}

interface VcsSupport {
  humanName: string;
  humanRepoName: string;
  humanOpLogCommand: string;
  isPresentCommand: string[];
  readOps(cwd: string): Op[];
}

export const VCS_SUPPORT: Record<Vcs, VcsSupport> = {
  jj: {
    humanName: "JJ",
    humanRepoName: "jj workspace",
    humanOpLogCommand: "jj op log",
    isPresentCommand: ["jj", "workspace", "root"],

    /**
     * The jj repo's operation log, newest first, one Op per operation.
     */
    readOps(cwd: string) {
      // Fields are separated by US (0x1F) and records by RS (0x1E) so
      // multi-line content (e.g. a `jj commit -m 'a\nb'` op description) stays
      // inside one record and doesn't split the frame.
      const template =
        'self.time().end().format("%Y-%m-%dT%H:%M:%S") ++ "\x1F" ++ self.attributes() ++ "\x1F" ++ self.description() ++ "\x1E"';

      const res = spawnSync(
        "jj",
        ["op", "log", "--no-graph", "--template", template],
        { cwd, encoding: "utf8" },
      );
      if (res.status !== 0) {
        throw new Error(`jj op log failed: ${res.stderr}`);
      }
      const ops: Op[] = [];
      for (const raw of res.stdout.split("\x1E")) {
        if (!raw) continue;
        const [timestamp, attributes, description] = raw.split("\x1F");
        if (!timestamp) continue;
        let field = attributes ?? "";
        if (field.startsWith("args: ")) field = field.slice("args: ".length);
        if (!field) field = description ?? "";
        if (!field) continue;
        const lines = field.split("\n");
        const line =
          lines.length > 1
            ? `${lines[0]} (${lines.length - 1} more lines elided)`
            : lines[0]!;
        ops.push({ timestamp, line });
      }
      return ops;
    },
  },
  git: {
    humanName: "Git",
    humanRepoName: "git repository",
    humanOpLogCommand: "git reflog",
    isPresentCommand: ["git", "rev-parse", "--show-toplevel"],

    /**
     * The git repo's reflog, newest first, one Op per entry.
     */
    readOps(cwd: string): Op[] {
      const res = spawnSync(
        "git",
        ["reflog", "show", "--date=iso-strict", "--format=%gd\t%gs"],
        { cwd, encoding: "utf8" },
      );
      if (res.status !== 0) throw new Error(`git reflog failed: ${res.stderr}`);
      const ops: Op[] = [];
      let index = 0;
      for (const raw of res.stdout.split("\n")) {
        if (!raw) continue;
        const tab = raw.indexOf("\t");
        if (tab < 0) continue;
        const selector = raw.slice(0, tab);
        const subject = raw.slice(tab + 1);
        const match = selector.match(/^(.+?)@\{(.+)\}$/);
        if (!match) continue;
        const [, ref, timestamp] = match;
        ops.push({
          timestamp: timestamp!,
          line: `${ref}@{${index}}: ${subject}`,
        });
        index++;
      }
      return ops;
    },
  },
};

/**
 * Whether `cwd` is inside a repo of the given VCS.
 */
function isVcsPresent(cwd: string, vcs: Vcs): boolean {
  const [command, ...commandArgs] = VCS_SUPPORT[vcs].isPresentCommand;
  const result = spawnSync(command!, commandArgs, { cwd, stdio: "ignore" });
  return result.status === 0;
}

/**
 * Resolves which VCS to use at `cwd`. When `requested` is "detect", tries jj
 * first, then git. When "jj" or "git", checks only that one. Returns null
 * when no candidate is present.
 */
export function resolveVcs(
  cwd: string,
  requestedVcs: "detect" | Vcs,
): Vcs | null {
  const candidates: Vcs[] =
    requestedVcs === "detect" ? ["jj", "git"] : [requestedVcs];
  return candidates.find((candidate) => isVcsPresent(cwd, candidate)) ?? null;
}

// -- Timestamps --

/**
 * Parses and canonicalizes an ISO-8601 datetime. Returns the trimmed input on
 * success, or null when it can't be interpreted as one.
 *
 * Bun/V8 don't expose `Temporal`, whose parsers are strict about ISO-8601, so
 * this uses `Date` (which accepts non-ISO formats like RFC 2822). A cheap shape
 * gate rejects the most obvious non-ISO inputs; the parsed value is never
 * re-serialized elsewhere, so the string that passed the check is the exact
 * string used downstream.
 */
export function parseIsoTimestamp(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(trimmed)) return null;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return trimmed;
}

// -- Since file --

/**
 * Reads the stored lower-bound timestamp, or null if the file is missing.
 * Throws when the file exists but its contents aren't a valid timestamp.
 */
export function readSinceFile(path: string): string | null {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException)?.code === "ENOENT") return null;
    throw e;
  }
  const parsed = parseIsoTimestamp(raw);
  if (parsed === null) {
    throw new Error(
      `\`--since-file=${path}\` was passed but the file's contents are not a valid ISO-8601 timestamp. Ensure that the correct file was passed.`,
    );
  }
  return parsed;
}

/**
 * Writes a timestamp to the since file, creating parent directories as needed.
 */
export function writeSinceFile(path: string, timestamp: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, timestamp + "\n");
}

// -- Formatting --

/**
 * Picks a word based on count, so "N more <word>" reads naturally.
 */
function pluralize(singular: string, plural: string, count: number): string {
  return count === 1 ? singular : plural;
}

/**
 * Builds the human-visible report for the given ops, applying the lower bound
 * and limit. Returns an empty string when there is nothing to say.
 */
export function filterAndFormat(
  ops: Op[],
  vcs: "jj" | "git",
  sinceBound: string | null,
  limit: number | null,
): string {
  const { humanName, humanOpLogCommand } = VCS_SUPPORT[vcs];
  const eligible = sinceBound
    ? ops.filter((op) => op.timestamp > sinceBound)
    : ops.slice();
  if (eligible.length === 0) return "";
  const shown = limit === null ? eligible : eligible.slice(0, limit);
  const elided = eligible.length - shown.length;
  return (
    [
      `Recent ${humanName} ops:`,
      ...shown.map((op) => `  ${op.timestamp}  ${op.line}`),
      elided > 0
        ? `${elided} more ${pluralize("op", "ops", elided)} elided; run \`${humanOpLogCommand}\` to see more.`
        : undefined,
    ]
      .filter((line) => line != null)
      .join("\n") + "\n"
  );
}

// -- Install --

/**
 * Quotes a string for embedding inside a shell command, using single quotes for
 * opaque values and double quotes when a `$VAR` should expand at run time.
 */
function shellQuote(s: string): string {
  if (/[$]/.test(s)) {
    return `"${s.replace(/(["\\`])/g, "\\$1")}"`;
  }
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

interface ClaudeCodeSettings {
  hooks?: Record<
    string,
    {
      matcher?: string;
      hooks: {
        type: string;
        command?: string;
      }[];
    }[]
  >;
  [key: string]: unknown;
}

/**
 * Writes a UserPromptSubmit + PostToolBatch hook entry into
 * `<configDir>/settings.json` pointing at this command. Idempotent:
 * pre-existing vcs-recent-history entries for the same events are removed and
 * replaced.
 */
export function installClaudeCodeGlobal(opts: {
  limit: number;
  configDir: string;
  scriptAbsPath: string;
}): void {
  // Claude Code passes hook context as JSON on stdin; `session_id` is the
  // per-conversation identifier. Use jq to extract it and build the state
  // path. `set -eu` fails loudly if jq is missing at run time or session_id
  // is null/missing.
  if (spawnSync("jq", ["--version"], { stdio: "ignore" }).status !== 0) {
    throw new Error(
      "The Claude Code hook requires `jq`. Install jq and ensure it is in $PATH.",
    );
  }

  const settingsPath = join(opts.configDir, "settings.json");
  const sinceFileExpr = `${opts.configDir}/vcs-recent-history/state/$session_id`;

  // Build the shared prefix: extract session_id from stdin, then capture the
  // tool's stdout. The captured output is used differently per event below.
  const prelude =
    `set -eu; session_id=$(jq -r .session_id); ` +
    `output=$(${shellQuote(opts.scriptAbsPath)} --audience=agent-via-hook ` +
    `--since-file=${shellQuote(sinceFileExpr)} --limit=${opts.limit})`;

  // UserPromptSubmit: raw stdout is added to Claude's context as-is.
  const userPromptSubmitCommand = `${prelude}; printf '%s' "$output"`;

  // PostToolBatch (fires after each parallel-tool batch, before the next model
  // call): raw stdout is not surfaced, but `additionalContext` in
  // hookSpecificOutput is. We use this instead of Stop because Stop's schema
  // does not permit hookSpecificOutput, so its output cannot reach Claude.
  //
  // Skip emission entirely when there's nothing to say, so an empty
  // additionalContext doesn't clutter the transcript.
  const postToolBatchCommand =
    `${prelude}; [ -n "$output" ] && jq -n --arg ctx "$output" ` +
    `'{hookSpecificOutput:{hookEventName:"PostToolBatch",additionalContext:$ctx}}'`;

  mkdirSync(opts.configDir, { recursive: true });
  let settings: ClaudeCodeSettings = {};
  if (existsSync(settingsPath)) {
    settings = JSON.parse(
      readFileSync(settingsPath, "utf8"),
    ) as ClaudeCodeSettings;
  }
  const hooksByEvent = settings["hooks"] ?? {};
  const commandsByEvent: Record<string, string> = {
    UserPromptSubmit: userPromptSubmitCommand,
    PostToolBatch: postToolBatchCommand,
  };
  // Scrub pre-existing vcs-recent-history entries from every event first, so a
  // previous install that targeted different events (e.g. Stop) leaves no
  // stale entries behind.
  for (const event of Object.keys(hooksByEvent)) {
    hooksByEvent[event] = (hooksByEvent[event] ?? []).filter((entry) => {
      return !entry?.hooks?.some(
        (hook) =>
          typeof hook?.command === "string" &&
          hook.command.includes("vcs-recent-history"),
      );
    });
  }
  for (const [event, command] of Object.entries(commandsByEvent)) {
    const existing = hooksByEvent[event] ?? [];
    existing.push({ hooks: [{ type: "command", command }] });
    hooksByEvent[event] = existing;
  }
  settings["hooks"] = hooksByEvent;
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
}

// -- List --

/**
 * Prints the recent-history report for the given cwd to stdout and, if a since
 * file path is provided, records the newest op's timestamp there. Silent when
 * the cwd is not a repo (under `vcs: "detect"`) or when nothing is above the
 * lower bound. Throws when an explicit `--vcs` doesn't match what's on disk.
 */
export function listRecentOps(opts: {
  cwd: string;
  vcsRequest: "detect" | "jj" | "git";
  sinceBound: string | null;
  sinceFilePath: string | null;
  limit: number | null;
}): void {
  const vcs = resolveVcs(opts.cwd, opts.vcsRequest);

  if (vcs === null) {
    if (opts.vcsRequest === "detect") return;
    throw new Error(
      `--vcs=${opts.vcsRequest} was passed but ${opts.cwd} is not inside a ${VCS_SUPPORT[opts.vcsRequest].humanRepoName}`,
    );
  }

  if (opts.sinceFilePath !== null && opts.sinceFilePath.endsWith("/")) {
    throw new Error(
      `--since-file=${opts.sinceFilePath} is not a valid file path (ends with '/'). Hint: Is a variable unset?`,
    );
  }

  const bound =
    opts.sinceBound ??
    (opts.sinceFilePath !== null ? readSinceFile(opts.sinceFilePath) : null);

  const ops = VCS_SUPPORT[vcs].readOps(opts.cwd);
  const out = filterAndFormat(ops, vcs, bound, opts.limit);
  if (out === "") return;
  process.stdout.write(out);
  if (opts.sinceFilePath !== null && ops.length > 0) {
    writeSinceFile(opts.sinceFilePath, ops[0]!.timestamp);
  }
}

// -- CLI --

/**
 * Parses a non-negative integer flag value, throwing a message that names the
 * flag on failure.
 */
function parseIntStrict(s: string, flag: string): number {
  if (!/^\d+$/.test(s)) {
    throw new Error(`${flag} must be a non-negative integer (got: ${s})`);
  }
  return parseInt(s, 10);
}

/**
 * Absolute path to the bin/vcs-recent-history shim, derived from this file's
 * location so `--install` records a stable path even when invoked via a shim.
 */
function resolveScriptAbsPath(): string {
  const here = new URL(".", import.meta.url).pathname;
  return join(here, "..", "..", "bin", "vcs-recent-history");
}

/**
 * Entry point: dispatches to `--install` or to a report run based on flags.
 */
async function main() {
  const parsed = new ArgsParser(args(), {});
  const install = parsed.get("install");
  const audience = parsed.get("audience");
  const since = parsed.get("since");
  const sinceFile = parsed.get("since-file");
  const limitStr = parsed.get("limit");
  const vcsFlag = parsed.get("vcs");

  if (install !== undefined) {
    if (install !== "claude-code-global") {
      throw new Error(`--install target not supported: ${install}`);
    }
    if (audience !== undefined) {
      throw new Error("--install disallows --audience");
    }
    if (sinceFile !== undefined) {
      throw new Error("--install disallows --since-file");
    }
    const limit =
      limitStr === undefined ? 3 : parseIntStrict(String(limitStr), "--limit");
    const configDir =
      process.env["CLAUDE_CONFIG_DIR"] ??
      join(process.env["HOME"] ?? "", ".claude");
    installClaudeCodeGlobal({
      limit,
      configDir,
      scriptAbsPath: resolveScriptAbsPath(),
    });
    return;
  } else {
    const chosenAudience = (audience ?? "human") as string;
    if (chosenAudience === "human") {
      throw new Error("--audience=human is not implemented yet");
    }
    if (chosenAudience !== "agent-via-hook") {
      throw new Error(
        `--audience must be 'human' or 'agent-via-hook' (got: ${chosenAudience})`,
      );
    }
    if (since !== undefined && sinceFile !== undefined) {
      throw new Error("--since and --since-file are mutually exclusive");
    }
    const vcsChoice = (vcsFlag ?? "detect") as string;
    if (!["detect", "jj", "git"].includes(vcsChoice)) {
      throw new Error(
        `--vcs must be one of 'detect', 'jj', or 'git' (got: ${vcsChoice})`,
      );
    }
    let sinceBound: string | null = null;
    if (typeof since === "string") {
      const parsedSince = parseIsoTimestamp(since);
      if (parsedSince === null) {
        throw new Error(
          `--since must be a valid ISO-8601 timestamp (got: ${since})`,
        );
      }
      sinceBound = parsedSince;
    }
    const limit =
      limitStr === undefined
        ? null
        : parseIntStrict(String(limitStr), "--limit");

    listRecentOps({
      cwd: process.cwd(),
      vcsRequest: vcsChoice as "detect" | "jj" | "git",
      sinceBound,
      sinceFilePath: typeof sinceFile === "string" ? sinceFile : null,
      limit,
    });
  }
}

if (import.meta.main) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    exit(1);
  });
}
