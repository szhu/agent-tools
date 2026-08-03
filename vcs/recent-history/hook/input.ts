export type HookEvent = "UserPromptSubmit" | "PreToolUse" | "PostToolUse";

export interface HookInput {
  hook_event_name: HookEvent;
  session_id: string;
  transcript_path: string;
  prompt_id?: string;
  tool_use_id?: string;
  duration_ms?: number;
}

const SUPPORTED: readonly HookEvent[] = [
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
];

export function parseHookInput(raw: string): HookInput {
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const eventName = parsed["hook_event_name"];
  if (
    typeof eventName !== "string" ||
    !SUPPORTED.includes(eventName as HookEvent)
  ) {
    throw new Error(`unsupported hook_event_name: ${eventName}`);
  }
  return {
    hook_event_name: eventName as HookEvent,
    session_id: String(parsed["session_id"] ?? ""),
    transcript_path: String(parsed["transcript_path"] ?? ""),
    prompt_id:
      typeof parsed["prompt_id"] === "string" ? parsed["prompt_id"] : undefined,
    tool_use_id:
      typeof parsed["tool_use_id"] === "string"
        ? parsed["tool_use_id"]
        : undefined,
    duration_ms:
      typeof parsed["duration_ms"] === "number"
        ? parsed["duration_ms"]
        : undefined,
  };
}
