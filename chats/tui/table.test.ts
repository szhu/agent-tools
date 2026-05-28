import { describe, expect, test } from "bun:test";
import { filterRows } from "./table.ts";

const cols = [
  { name: "id", value: (r: { id: string; type: string }) => r.id },
  { name: "type", value: (r: { id: string; type: string }) => r.type },
];
const rows = [
  { id: "a", type: "human" },
  { id: "b", type: "assistant" },
];

describe("filterRows", () => {
  test("filters by column value", () => {
    const result = filterRows(rows, cols, "type:human");
    expect(result).toEqual([{ id: "a", type: "human" }]);
  });

  test("throws on missing colon", () => {
    expect(() => filterRows(rows, cols, "nocolon")).toThrow(
      "expected 'column:value'",
    );
  });

  test("throws on unknown column", () => {
    expect(() => filterRows(rows, cols, "bogus:x")).toThrow(
      "Invalid filter column 'bogus'",
    );
  });
});
