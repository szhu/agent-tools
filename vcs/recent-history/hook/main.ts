import { ArgsParser, args, exit } from "@cross/utils";
import { join } from "@std/path";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolveVcs } from "../main.ts";
import { appendIndex, readIndex } from "./index.ts";
import { parseHookInput, type HookEvent } from "./input.ts";
import { installHooks, uninstallHooks } from "./install.ts";
import {
  currentPromptIdFromTranscript,
  findPreviousFireTimestamp,
} from "./transcript.ts";

type Vcs = "jj" | "git";

function defaultIndexPath(sessionId: string): string {
  const overridePath = process.env["VCS_RECENT_HISTORY_HOOK_INDEX"];
  if (overridePath !== undefined) return overridePath;
  const home = process.env["HOME"] ?? "";
  const configDir = process.env["CLAUDE_CONFIG_DIR"] ?? join(home, ".claude");
  return join(configDir, "vcs-recent-history", "index", `${sessionId}.jsonl`);
}

function runQuery(
  cwd: string,
  vcs: Vcs,
  since: string | null,
  limit: number,
): string {
  const here = new URL(".", import.meta.url).pathname;
  const queryShim = join(here, "..", "..", "..", "bin", "vcs-recent-history");
  const shimArgs: string[] = [`--vcs=${vcs}`, `--limit=${limit}`];
  if (since !== null) shimArgs.push(`--since=${since}`);
  const result = spawnSync(queryShim, shimArgs, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`vcs-recent-history failed: ${result.stderr}`);
  }
  return result.stdout;
}

/**
 * The VCS-native term pair (label + entry noun) used in agent-facing prose per
 * the plan's terminology rule.
 */
function vcsTerms(vcs: Vcs): { label: string; entryTerm: string } {
  if (vcs === "git") return { label: "Git", entryTerm: "reflog entries" };
  return { label: "JJ", entryTerm: "operations" };
}

/**
 * Composes the event-specific opening line and FYI trailer per the plan's
 * Example Outputs.
 */
function makeFraming(
  event: HookEvent,
  vcsLabel: string,
  entryTerm: string,
  opts: { baseline: boolean; disclaimerDurationMs: number | null },
): { opening: string; trailer: string } {
  if (opts.baseline) {
    return {
      opening: `Notification: Here are the most recent ${vcsLabel} ${entryTerm}:`,
      trailer:
        "This is just an FYI in case you are making changes that relate to the above. Next time when this hook runs, we'll only show you changes that occurred since now.",
    };
  }
  if (event === "UserPromptSubmit" || event === "PreToolUse") {
    return {
      opening: `Notification: These ${vcsLabel} ${entryTerm} occurred since the end of your last tool call; they were definitely not caused by any of your foreground actions.`,
      trailer:
        "This is just an FYI in case you are making changes that relate to the above. You don't have to do anything with the output if it's pretty clear that the user/background task/background agent is working on an orthogonal task, or if the changes seem to be part of an automated process from a VCS client.",
    };
  }
  // PostToolUse
  if (opts.disclaimerDurationMs === null) {
    return {
      opening: `These ${vcsLabel} ${entryTerm} occurred during your tool call; they were likely caused by your actions.`,
      trailer: "This is just an FYI so you can check your work.",
    };
  }
  const durationSeconds = (opts.disclaimerDurationMs / 1000).toFixed(1);
  return {
    opening: `These ${vcsLabel} ${entryTerm} occurred during your tool call:`,
    trailer: `This is just an FYI in case you are making changes that relate to the above. Your tool call was not instantaneous (${durationSeconds}s) and this hook is not able to automatically determine whether the changes were caused by your foreground actions or the user/background tasks/background agents; consider double checking.`,
  };
}

function emitForEvent(
  event: HookEvent,
  vcs: Vcs,
  queryOutput: string,
  opts: { baseline: boolean; disclaimerDurationMs: number | null },
): void {
  // Query CLI output shape is bare rows plus an elision line — no header, no
  // indent. Compose our per-event opening + trailer around it directly.
  const { label, entryTerm } = vcsTerms(vcs);
  const { opening, trailer } = makeFraming(event, label, entryTerm, opts);

  // queryOutput already ends with `\n`; add another to separate from the trailer.
  const finalBody = `${opening}\n${queryOutput}\n${trailer}\n`;

  if (event === "UserPromptSubmit") {
    process.stdout.write(finalBody);
    return;
  }
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: event,
        additionalContext: finalBody,
      },
    }) + "\n",
  );
}

async function main() {
  const parsed = new ArgsParser(args(), {});
  const install = parsed.get("install");
  const uninstall = parsed.getBoolean("uninstall");
  const limitStr = parsed.get("limit");

  if (install !== undefined) {
    if (install !== "claude-code-global") {
      throw new Error(`--install target not supported: ${install}`);
    }
    const configDir =
      process.env["CLAUDE_CONFIG_DIR"] ??
      join(process.env["HOME"] ?? "", ".claude");
    const scriptAbsPath = join(
      new URL(".", import.meta.url).pathname,
      "..",
      "..",
      "..",
      "bin",
      "vcs-recent-history-hook",
    );
    const limit = limitStr === undefined ? 3 : parseInt(String(limitStr), 10);
    installHooks({ configDir, scriptAbsPath, limit });
    return;
  }

  if (uninstall) {
    const configDir =
      process.env["CLAUDE_CONFIG_DIR"] ??
      join(process.env["HOME"] ?? "", ".claude");
    uninstallHooks({ configDir });
    return;
  }

  const limit = limitStr === undefined ? 3 : parseInt(String(limitStr), 10);
  const raw = readFileSync(0, "utf8");
  const hook = parseHookInput(raw);
  const cwd = process.cwd();
  // Detect the VCS once and pass it explicitly to the query CLI, so the two
  // can't disagree. Silent if the cwd isn't in a repo — nothing to report.
  const vcs = resolveVcs(cwd, "detect");
  if (vcs === null) return;

  // `claude -p` omits prompt_id from the UserPromptSubmit hook payload, so
  // fall back to the transcript's latest user entry's promptId. Keeps the
  // index keyed by an id the walker will later harvest.
  const currentId =
    hook.tool_use_id ??
    hook.prompt_id ??
    currentPromptIdFromTranscript(hook.transcript_path);
  const indexPath = defaultIndexPath(hook.session_id);
  const index = readIndex(indexPath);

  const since = findPreviousFireTimestamp({
    transcriptPath: hook.transcript_path,
    index,
  });

  const body = runQuery(cwd, vcs, since, limit);
  if (body !== "") {
    const disclaimerDurationMs =
      hook.hook_event_name === "PostToolUse" && (hook.duration_ms ?? 0) > 300
        ? (hook.duration_ms ?? 0)
        : null;
    emitForEvent(hook.hook_event_name, vcs, body, {
      baseline: since === null,
      disclaimerDurationMs,
    });
  }

  if (currentId !== null && currentId !== undefined) {
    appendIndex(indexPath, currentId, new Date().toISOString());
  }
}

if (import.meta.main) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    exit(1);
  });
}
