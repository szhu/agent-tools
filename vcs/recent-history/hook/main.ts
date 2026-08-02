import { ArgsParser, args, exit } from "@cross/utils";
import { join } from "@std/path";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { appendIndex, readIndex } from "./index.ts";
import { parseHookInput, type HookEvent } from "./input.ts";
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

const BASELINE_PREFIX = "First observation in this conversation. ";
function disclaimerTemplate(durationMs: number): string {
  return `Note: this tool call was not instantaneous (${(durationMs / 1000).toFixed(1)}s) and this hook is not able to automatically determine whether the changes were caused by your foreground actions or the user/background tasks/background agents; consider double checking.\n`;
}

function emitForEvent(
  event: HookEvent,
  body: string,
  opts: { baseline: boolean; disclaimerDurationMs: number | null },
): void {
  let finalBody = body;
  if (opts.baseline) finalBody = BASELINE_PREFIX + finalBody;
  if (opts.disclaimerDurationMs !== null) {
    finalBody = finalBody + disclaimerTemplate(opts.disclaimerDurationMs);
  }
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

  if (install !== undefined || uninstall) {
    throw new Error("install/uninstall not implemented yet");
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
