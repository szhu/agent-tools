import { describe, expect, test } from "bun:test";
import type { ClaudeCodeMessage } from "../data/types.ts";
import { contentPreview } from "./ls.ts";

function makeMessage(content: unknown): ClaudeCodeMessage {
  return { message: { content } } as unknown as ClaudeCodeMessage;
}

describe("contentPreview", () => {
  test("no content", () => {
    expect(contentPreview({ message: undefined } as unknown as ClaudeCodeMessage)).toBe("");
  });

  test("string content collapses newlines", () => {
    expect(contentPreview(makeMessage("hello\nworld"))).toBe("hello  world");
  });

  test("text array collapses newlines and joins", () => {
    expect(contentPreview(makeMessage([
      { type: "text", text: "hello\nworld" },
      { type: "text", text: "foo" },
    ]))).toBe("hello  world  foo");
  });

  test("thinking array", () => {
    expect(contentPreview(makeMessage([{ type: "thinking", thinking: "hmm\nok" }]))).toBe("hmm  ok");
  });

  test("tool_use no description single input", () => {
    expect(contentPreview(makeMessage([
      { type: "tool_use", name: "Read", input: { file_path: "/foo/bar" } },
    ]))).toBe('Read "/foo/bar"');
  });

  test("tool_use with description single remaining input", () => {
    expect(contentPreview(makeMessage([
      { type: "tool_use", name: "Bash", input: { command: "ls", description: "List files" } },
    ]))).toBe('Bash (List files) "ls"');
  });

  test("tool_use with description no remaining input", () => {
    expect(contentPreview(makeMessage([
      { type: "tool_use", name: "Bash", input: { description: "Do thing" } },
    ]))).toBe("Bash (Do thing)");
  });

  test("tool_use with description multiple remaining inputs", () => {
    expect(contentPreview(makeMessage([
      { type: "tool_use", name: "Edit", input: { description: "Fix", file_path: "/a", old_string: "x", new_string: "y" } },
    ]))).toBe('Edit (Fix) {"file_path":"/a","old_string":"x","new_string":"y"}');
  });

  test("tool_use no description multiple inputs", () => {
    expect(contentPreview(makeMessage([
      { type: "tool_use", name: "Edit", input: { file_path: "/a", old_string: "x", new_string: "y" } },
    ]))).toBe('Edit {"file_path":"/a","old_string":"x","new_string":"y"}');
  });

  test("tool_use strips id and caller", () => {
    expect(contentPreview(makeMessage([
      { type: "tool_use", id: "toolu_123", name: "Read", input: { file_path: "/x" }, caller: { type: "direct" } },
    ]))).toBe('Read "/x"');
  });

  test("multiple tool_use joined", () => {
    expect(contentPreview(makeMessage([
      { type: "tool_use", name: "Read", input: { file_path: "/a" } },
      { type: "tool_use", name: "Read", input: { file_path: "/b" } },
    ]))).toBe('Read "/a"  Read "/b"');
  });

  test("tool_result single content value", () => {
    expect(contentPreview(makeMessage([
      { tool_use_id: "x", type: "tool_result", content: "the output", is_error: false },
    ]))).toBe('"the output"');
  });

  test("tool_result collapses newlines via JSON encoding", () => {
    expect(contentPreview(makeMessage([
      { tool_use_id: "x", type: "tool_result", content: "line1\nline2", is_error: false },
    ]))).toBe('"line1\\nline2"');
  });

  test("tool_result multiple remaining fields", () => {
    expect(contentPreview(makeMessage([
      { tool_use_id: "x", type: "tool_result", content: "out", extra: "val" },
    ]))).toBe('{"content":"out","extra":"val"}');
  });
});
