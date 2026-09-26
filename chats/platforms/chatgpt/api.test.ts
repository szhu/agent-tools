import { describe, expect, test } from "bun:test";
import { formatErrorDetail } from "./api.ts";

describe("formatErrorDetail", () => {
  test("returns detail as-is when it's a string", () => {
    expect(formatErrorDetail({ detail: "Not found." }, "fallback")).toBe(
      "Not found.",
    );
  });

  test("stringifies detail when it's an object, rather than [object Object]", () => {
    const json = {
      detail: {
        message: "You don't have access to this conversation.",
        code: "conversation_inaccessible",
      },
    };
    expect(formatErrorDetail(json, "fallback")).toBe(JSON.stringify(json.detail));
  });

  test("falls back to the raw response text when there's no detail field", () => {
    expect(formatErrorDetail({ other: "field" }, "raw text")).toBe("raw text");
  });

  test("falls back to the raw response text when json isn't an object", () => {
    expect(formatErrorDetail("just a string", "raw text")).toBe("raw text");
    expect(formatErrorDetail(null, "raw text")).toBe("raw text");
  });
});
