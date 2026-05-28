import { describe, expect, test } from "bun:test";
import { parseAddress, parseRange } from "./parse.ts";

describe("parseAddress", () => {
  test("/ = all projects", () =>
    expect(parseAddress("/")).toEqual({ pathInput: "/" }));
  test(". = current project", () =>
    expect(parseAddress(".")).toEqual({ pathInput: "." }));
  test("absolute project", () =>
    expect(parseAddress("/Users/Me/Code")).toEqual({
      pathInput: "/Users/Me/Code",
    }));

  test("bare chat id", () =>
    expect(parseAddress("a243a4")).toEqual({ chatInput: "a243a4" }));

  test("chat/message", () =>
    expect(parseAddress("a243a4/cade7f")).toEqual({
      chatInput: "a243a4",
      messagesInput: "cade7f",
    }));

  test("project:chat", () =>
    expect(parseAddress("/Users/Me/Code:a243a4")).toEqual({
      pathInput: "/Users/Me/Code",
      chatInput: "a243a4",
    }));

  test("project:chat/message", () =>
    expect(parseAddress("/Users/Me/Code:a243a4/cade7f")).toEqual({
      pathInput: "/Users/Me/Code",
      chatInput: "a243a4",
      messagesInput: "cade7f",
    }));

  test("inclusive range", () =>
    expect(parseAddress("a243a4/[cade7f..=2b3de0]")).toEqual({
      chatInput: "a243a4",
      messagesInput: "[cade7f..=2b3de0]",
    }));

  test("exclusive range", () =>
    expect(parseAddress("a243a4/[cade7f..<2b3de0]")).toEqual({
      chatInput: "a243a4",
      messagesInput: "[cade7f..<2b3de0]",
    }));

  test(".jsonl file path", () =>
    expect(parseAddress("/path/to/chat.jsonl")).toEqual({
      pathInput: "/path/to/chat.jsonl",
    }));

  test(".jsonl file path with message", () =>
    expect(parseAddress("/path/to/chat.jsonl/cade7f")).toEqual({
      pathInput: "/path/to/chat.jsonl",
      messagesInput: "cade7f",
    }));

  test("bare .. stays as messagesInput (not a valid range)", () =>
    expect(parseAddress("a243a4/[cade7f..2b3de0]")).toEqual({
      chatInput: "a243a4",
      messagesInput: "[cade7f..2b3de0]",
    }));
});

describe("parseRange", () => {
  test("inclusive", () =>
    expect(parseRange("[cade7f..=2b3de0]")).toEqual({
      start: "cade7f",
      startInclusive: true,
      end: "2b3de0",
      endInclusive: true,
    }));

  test("exclusive", () =>
    expect(parseRange("[cade7f..<2b3de0]")).toEqual({
      start: "cade7f",
      startInclusive: true,
      end: "2b3de0",
      endInclusive: false,
    }));

  test("bare .. is invalid", () =>
    expect(parseRange("[cade7f..2b3de0]")).toBeUndefined());

  test("non-range string is invalid", () =>
    expect(parseRange("cade7f")).toBeUndefined());
});
