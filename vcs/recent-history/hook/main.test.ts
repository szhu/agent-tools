import { describe, expect, test } from "bun:test";
import { parseHookInput } from "./input.ts";

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
