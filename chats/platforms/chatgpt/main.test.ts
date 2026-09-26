import { describe, expect, test } from "bun:test";
import { parseDurationMs } from "./main.ts";

describe("parseDurationMs", () => {
  test("parses each unit", () => {
    expect(parseDurationMs("500ms")).toBe(500);
    expect(parseDurationMs("30s")).toBe(30_000);
    expect(parseDurationMs("5m")).toBe(300_000);
    expect(parseDurationMs("2h")).toBe(7_200_000);
    expect(parseDurationMs("1d")).toBe(86_400_000);
  });

  test("bare 0 means force-refresh, no unit required", () => {
    expect(parseDurationMs("0")).toBe(0);
  });

  test("rejects a bare number with no unit (other than 0)", () => {
    expect(() => parseDurationMs("5")).toThrow();
  });

  test("rejects an unrecognized unit", () => {
    expect(() => parseDurationMs("5w")).toThrow();
  });

  test("rejects garbage input", () => {
    expect(() => parseDurationMs("soon")).toThrow();
  });
});
