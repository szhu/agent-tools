import { ArgsParser, args, exit } from "@cross/utils";
import { spawnSync } from "node:child_process";

// -- VCS resolution --

type Vcs = "jj" | "git";

export interface HistoryEntry {
  timestamp: string;
  line: string;
}

interface VcsSupport {
  humanRepoName: string;
  humanOpLogCommand: string;
  isPresentCommand: string[];
  readEntries(cwd: string): HistoryEntry[];
}

export const VCS_SUPPORT: Record<Vcs, VcsSupport> = {
  jj: {
    humanRepoName: "jj workspace",
    humanOpLogCommand: "jj op log",
    isPresentCommand: ["jj", "workspace", "root"],

    /**
     * The jj repo's operation log, newest first, one HistoryEntry per
     * operation.
     */
    readEntries(cwd: string) {
      // Fields are separated by US (0x1F) and records by RS (0x1E) so
      // multi-line content (e.g. a `jj commit -m 'a\nb'` op description) stays
      // inside one record and doesn't split the frame.
      // Include ms + tz offset. Without ms, ops that land in the same second
      // as a hook fire's ts get filtered out by the "since" bound (which does
      // carry ms), missing legitimate ops that happened after the fire.
      const template =
        'self.time().end().format("%Y-%m-%dT%H:%M:%S%.3f%:z") ++ "\x1F" ++ self.id().short() ++ "\x1F" ++ self.attributes() ++ "\x1F" ++ self.description() ++ "\x1E"';

      const res = spawnSync(
        "jj",
        ["op", "log", "--no-graph", "--template", template],
        { cwd, encoding: "utf8" },
      );
      if (res.status !== 0) {
        throw new Error(`jj op log failed: ${res.stderr}`);
      }
      const entries: HistoryEntry[] = [];
      for (const raw of res.stdout.split("\x1E")) {
        if (!raw) continue;
        const [timestamp, opId, attributes, description] = raw.split("\x1F");
        if (!timestamp) continue;
        let field = attributes ?? "";
        if (field.startsWith("args: ")) field = field.slice("args: ".length);
        if (!field) field = description ?? "";
        if (!field) continue;
        const lines = field.split("\n");
        const body =
          lines.length > 1
            ? `${lines[0]} (${lines.length - 1} more lines elided)`
            : lines[0]!;
        entries.push({ timestamp, line: `${opId}  ${body}` });
      }
      return entries;
    },
  },
  git: {
    humanRepoName: "git repository",
    humanOpLogCommand: "git reflog",
    isPresentCommand: ["git", "rev-parse", "--show-toplevel"],

    /** The git repo's reflog, newest first, one HistoryEntry per entry. */
    readEntries(cwd: string): HistoryEntry[] {
      const res = spawnSync(
        "git",
        ["reflog", "show", "--date=iso-strict", "--format=%gd\t%h\t%gs"],
        { cwd, encoding: "utf8" },
      );
      if (res.status !== 0) throw new Error(`git reflog failed: ${res.stderr}`);
      const entries: HistoryEntry[] = [];
      for (const raw of res.stdout.split("\n")) {
        if (!raw) continue;
        const parts = raw.split("\t");
        if (parts.length < 3) continue;
        const [selector, hash, subject] = parts;
        const match = selector!.match(/^(.+?)@\{(.+)\}$/);
        if (!match) continue;
        const [, , timestamp] = match;
        entries.push({
          timestamp: timestamp!,
          line: `${hash}  ${subject}`,
        });
      }
      return entries;
    },
  },
};

/** Whether `cwd` is inside a repo of the given VCS. */
function isVcsPresent(cwd: string, vcs: Vcs): boolean {
  const [command, ...commandArgs] = VCS_SUPPORT[vcs].isPresentCommand;
  const result = spawnSync(command!, commandArgs, { cwd, stdio: "ignore" });
  return result.status === 0;
}

/**
 * Resolves which VCS to use at `cwd`. When `requested` is "detect", tries jj
 * first, then git. When "jj" or "git", checks only that one. Returns null when
 * no candidate is present.
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

// -- Formatting --

/**
 * Builds the human-visible report for the given ops, applying the lower bound
 * and limit. Returns an empty string when there is nothing to say.
 */
export function filterAndFormat(
  entries: HistoryEntry[],
  vcs: "jj" | "git",
  sinceBound: string | null,
  limit: number | null,
): string {
  const { humanOpLogCommand } = VCS_SUPPORT[vcs];
  // Compare as instants, not strings — jj emits local-time-no-offset and git
  // emits local-with-offset, but the walker's sinceBound is UTC (`…Z`). String
  // comparison across zones silently mis-orders and hides valid ops.
  const boundMs = sinceBound === null ? null : new Date(sinceBound).getTime();
  const eligible =
    boundMs === null
      ? entries.slice()
      : entries.filter(
          (entry) => new Date(entry.timestamp).getTime() > boundMs,
        );
  if (eligible.length === 0) return "";
  const shown = limit === null ? eligible : eligible.slice(0, limit);
  const elided = eligible.length - shown.length;
  return (
    [
      ...shown.map((entry) => `${entry.timestamp}  ${entry.line}`),
      elided > 0
        ? `${elided} more elided; run \`${humanOpLogCommand}\` to see more.`
        : undefined,
    ]
      .filter((line) => line != null)
      .join("\n") + "\n"
  );
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

/** Entry point: reads the VCS history and prints the report. */
async function main() {
  const parsed = new ArgsParser(args(), {});
  const since = parsed.get("since");
  const limitStr = parsed.get("limit");
  const vcsFlag = parsed.get("vcs");

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
    limitStr === undefined ? null : parseIntStrict(String(limitStr), "--limit");

  const cwd = process.cwd();
  const vcs = resolveVcs(cwd, vcsChoice as "detect" | "jj" | "git");
  if (vcs === null) {
    if (vcsChoice === "detect") return;
    throw new Error(
      `--vcs=${vcsChoice} was passed but ${cwd} is not inside a ${VCS_SUPPORT[vcsChoice as "jj" | "git"].humanRepoName}`,
    );
  }
  const entries = VCS_SUPPORT[vcs].readEntries(cwd);
  const out = filterAndFormat(entries, vcs, sinceBound, limit);
  if (out !== "") process.stdout.write(out);
}

if (import.meta.main) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    exit(1);
  });
}
