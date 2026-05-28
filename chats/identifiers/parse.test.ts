import { describe, expect, test } from "bun:test";
import { parseAddress } from "./parse.ts";

describe("parseAddress", () => {
  test("/ = all projects", () =>
    expect(parseAddress("/")).toEqual({ projectPath: "/" }));
  test(". = current project", () =>
    expect(parseAddress(".")).toEqual({ projectPath: "." }));
  test("absolute project", () =>
    expect(parseAddress("/Users/Me/Code")).toEqual({
      projectPath: "/Users/Me/Code",
    }));

  test("bare chat id", () =>
    expect(parseAddress("a243a4")).toEqual({
      projectPath: undefined,
      chatId: "a243a4",
    }));

  test("chat/message", () =>
    expect(parseAddress("a243a4/cade7f")).toEqual({
      projectPath: undefined,
      chatId: "a243a4",
      messageId: "cade7f",
    }));

  test("project:chat", () =>
    expect(parseAddress("/Users/Me/Code:a243a4")).toEqual({
      projectPath: "/Users/Me/Code",
      chatId: "a243a4",
    }));

  test("project:chat/message", () =>
    expect(parseAddress("/Users/Me/Code:a243a4/cade7f")).toEqual({
      projectPath: "/Users/Me/Code",
      chatId: "a243a4",
      messageId: "cade7f",
    }));

  test("inclusive range", () =>
    expect(parseAddress("a243a4/[cade7f..=2b3de0]")).toEqual({
      projectPath: undefined,
      chatId: "a243a4",
      messageId: undefined,
      range: {
        start: "cade7f",
        startInclusive: true,
        end: "2b3de0",
        endInclusive: true,
      },
    }));

  test("exclusive range", () =>
    expect(parseAddress("a243a4/[cade7f..<2b3de0]")).toEqual({
      projectPath: undefined,
      chatId: "a243a4",
      messageId: undefined,
      range: {
        start: "cade7f",
        startInclusive: true,
        end: "2b3de0",
        endInclusive: false,
      },
    }));

  test(".jsonl file path", () =>
    expect(parseAddress("/path/to/chat.jsonl")).toEqual({
      projectPath: "/path/to/chat.jsonl",
      chatId: "chat",
      messageId: undefined,
      isJsonlPath: true,
    }));

  test(".jsonl file path with message", () =>
    expect(parseAddress("/path/to/chat.jsonl/cade7f")).toEqual({
      projectPath: "/path/to/chat.jsonl",
      chatId: "chat",
      messageId: "cade7f",
      isJsonlPath: true,
    }));

  test("bare .. is a parse error (no implicit inclusive)", () => {
    const result = parseAddress("a243a4/[cade7f..2b3de0]");
    expect(result.range).toBeUndefined();
    expect(result.messageId).toBe("[cade7f..2b3de0]");
  });
});
