import { ArgsParser, args, exit } from "@cross/utils";
import { join } from "@std/path";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { appendIndex, readIndex } from "./index.ts";
import { parseHookInput, type HookEvent } from "./input.ts";
import { installHooks, uninstallHooks } from "./install.ts";
import { findPreviousFireTimestamp } from "./transcript.ts";

function defaultIndexPath(sessionId: string): string {
  const overridePath = process.env["VCS_RECENT_HISTORY_HOOK_INDEX"];
  if (overridePath !== undefined) return overridePath;
  const home = process.env["HOME"] ?? "";
  const configDir = process.env["CLAUDE_CONFIG_DIR"] ?? join(home, ".claude");
  return join(configDir, "vcs-recent-history", "index", `${sessionId}.jsonl`);
}

function runQuery(cwd: string, since: string | null, limit: number): string {
  const here = new URL(".", import.meta.url).pathname;
  const queryShim = join(here, "..", "..", "..", "bin", "vcs-recent-history");
  const shimArgs: string[] = [`--audience=agent-via-hook`, `--limit=${limit}`];
  if (since !== null) shimArgs.push(`--since=${since}`);
  const result = spawnSync(queryShim, shimArgs, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`vcs-recent-history failed: ${result.stderr}`);
  }
  return result.stdout;
}

/**
 * Extracts the VCS-native term pair (label + entry noun) from the query CLI's
 * first output line, which currently reads "Recent JJ ops:" or "Recent Git
 * ops:". We use the native tool's vocabulary in agent-facing prose per the
 * plan's terminology rule.
 */
function vcsTermsFromQueryHeader(header: string): {
  label: string;
  entryTerm: string;
} {
  if (header.includes("Git"))
    return { label: "Git", entryTerm: "reflog entries" };
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
  queryOutput: string,
  opts: { baseline: boolean; disclaimerDurationMs: number | null },
): void {
  // Query CLI output shape:
  //   Recent JJ ops:
  //     <row>
  //     ...
  //   N more elided; run `jj op log` to see more.
  // Strip the first line (the query CLI header) and replace with our per-event
  // opening; append the per-event trailer.
  const newlineIndex = queryOutput.indexOf("\n");
  const queryHeader =
    newlineIndex >= 0 ? queryOutput.slice(0, newlineIndex) : queryOutput;
  const body = newlineIndex >= 0 ? queryOutput.slice(newlineIndex + 1) : "";
  const { label, entryTerm } = vcsTermsFromQueryHeader(queryHeader);
  const { opening, trailer } = makeFraming(event, label, entryTerm, opts);

  // body already ends with `\n`; add another to separate from the trailer.
  const finalBody = `${opening}\n${body}\n${trailer}\n`;

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
  const currentId = hook.tool_use_id ?? hook.prompt_id;
  const indexPath = defaultIndexPath(hook.session_id);
  const index = readIndex(indexPath);

  const since = findPreviousFireTimestamp({
    transcriptPath: hook.transcript_path,
    index,
  });

  const body = runQuery(process.cwd(), since, limit);
  if (body !== "") {
    const disclaimerDurationMs =
      hook.hook_event_name === "PostToolUse" && (hook.duration_ms ?? 0) > 300
        ? (hook.duration_ms ?? 0)
        : null;
    emitForEvent(hook.hook_event_name, body, {
      baseline: since === null,
      disclaimerDurationMs,
    });
  }

  appendIndex(indexPath, currentId, new Date().toISOString());
}

if (import.meta.main) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    exit(1);
  });
}
