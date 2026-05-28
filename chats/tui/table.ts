import { getEnv } from "@cross/env";
import { stdout } from "node:process";

const COLUMN_GAP = 4;

function terminalWidth(): number | undefined {
  if (stdout.columns) return stdout.columns;
  const cols = parseInt(getEnv("COLUMNS") ?? "");
  if (!isNaN(cols) && cols > 0) return cols;
  return undefined;
}

export type Col<T> = {
  name: string;
  value: (row: T) => string; // raw value used for sorting
  format?: (row: T) => string; // display value (defaults to value)
};

export function filterRows<T>(
  rows: T[],
  cols: Col<T>[],
  filterStr: string,
): T[] {
  const filters = filterStr
    .split(",")
    .filter(Boolean)
    .map((clause) => {
      const colonPosition = clause.indexOf(":");
      if (colonPosition === -1)
        throw new Error(`Invalid filter '${clause}': expected 'column:value'`);
      const name = clause.slice(0, colonPosition);
      const values = new Set(clause.slice(colonPosition + 1).split("|"));
      const col = cols.find((c) => c.name === name);
      if (!col)
        throw new Error(
          `Invalid filter column '${name}'. Valid: ${cols.map((c) => c.name).join(", ")}`,
        );
      return { col, values };
    });
  return rows.filter((row) =>
    filters.every((f) => f.values.has(f.col.value(row))),
  );
}

export function printTable<T>(
  rows: T[],
  cols: Col<T>[],
  sortStr?: string,
): void {
  const sorts = (sortStr ?? "")
    .split(",")
    .filter(Boolean)
    .map((s) => {
      const desc = s.endsWith("-");
      const name = desc || s.endsWith("+") ? s.slice(0, -1) : s;
      const col = cols.find((c) => c.name === name);
      if (!col)
        throw new Error(
          `Invalid sort column '${name}'. Valid: ${cols.map((c) => c.name).join(", ")}`,
        );
      return { col, desc };
    });

  const sorted = sorts.length
    ? [...rows].sort((a, b) => {
        for (const { col, desc } of sorts) {
          const cmp = col.value(a).localeCompare(col.value(b));
          if (cmp !== 0) return desc ? -cmp : cmp;
        }
        return 0;
      })
    : rows;

  const grid = [
    cols.map((c) => c.name),
    ...sorted.map((r) => cols.map((c) => (c.format ?? c.value)(r))),
  ];

  const colWidths = cols.map((_, i) =>
    Math.max(...grid.map((row) => (row[i] ?? "").length)),
  );

  const width = terminalWidth();
  if (width !== undefined) {
    const fixedWidth = colWidths
      .slice(0, -1)
      .reduce((sum, w) => sum + w + COLUMN_GAP, 0);
    const lastColMax = width - fixedWidth - 4;
    if (lastColMax < colWidths[colWidths.length - 1]!) {
      colWidths[colWidths.length - 1] = lastColMax;
      const lastIndex = cols.length - 1;
      for (const row of grid) {
        if ((row[lastIndex]?.length ?? 0) > lastColMax) {
          row[lastIndex] = row[lastIndex]!.slice(0, lastColMax);
        }
      }
    }
  }

  for (const row of grid) {
    console.log(
      row
        .map((cell, i) =>
          i < cols.length - 1 ? cell.padEnd(colWidths[i]! + COLUMN_GAP) : cell,
        )
        .join(""),
    );
  }
}
