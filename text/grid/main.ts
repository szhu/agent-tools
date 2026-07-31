import { ArgsParser, args, exit } from "@cross/utils";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

// -- Types --

export type RangeSpec =
  | { kind: "range"; r1?: number; c1?: number; r2?: number; c2?: number }
  | { kind: "size"; r1?: number; c1?: number; h?: number; w?: number };

export interface Rect {
  r1: number;
  c1: number;
  r2: number;
  c2: number;
}

// -- Parsing --

const PARENS_RE = /^\(([^,()]*),([^,()]*)\)([-x])\(([^,()]*),([^,()]*)\)$/;
const COLON_HEAD_RE = /^([^:]*):(.*)$/;

function toIntOrUndef(s: string): number | undefined {
  if (s === "") return undefined;
  if (!/^\d+$/.test(s)) throw new Error(`Not a non-negative integer: "${s}"`);
  return parseInt(s, 10);
}

export function parseRange(input: string): RangeSpec {
  if (input.startsWith("(")) {
    const m = input.match(PARENS_RE);
    if (!m) throw new Error(`Invalid range: ${input}`);
    const [, aS, bS, op, cS, dS] = m;
    const i1 = toIntOrUndef(aS!);
    const j1 = toIntOrUndef(bS!);
    const x = toIntOrUndef(cS!);
    const y = toIntOrUndef(dS!);
    const r1 = i1 === undefined ? undefined : i1 + 1;
    const c1 = j1 === undefined ? undefined : j1 + 1;
    if (op === "-") {
      // 0-indexed exclusive end == 1-indexed inclusive end
      return { kind: "range", r1, c1, r2: x, c2: y };
    } else {
      // (h, w) size
      return { kind: "size", r1, c1, h: x, w: y };
    }
  }

  const dash = input.indexOf("-");
  if (dash < 0) throw new Error(`Invalid range: ${input}`);
  const head = input.slice(0, dash);
  const tail = input.slice(dash + 1);

  const hm = head.match(COLON_HEAD_RE);
  if (!hm) throw new Error(`Invalid range head: "${head}"`);
  const r1 = toIntOrUndef(hm[1]!);
  const c1 = toIntOrUndef(hm[2]!);

  if (tail.includes("x")) {
    const parts = tail.split("x");
    if (parts.length !== 2) throw new Error(`Invalid size tail: "${tail}"`);
    const w = toIntOrUndef(parts[0]!);
    const h = toIntOrUndef(parts[1]!);
    return { kind: "size", r1, c1, h, w };
  } else {
    const tm = tail.match(COLON_HEAD_RE);
    if (!tm) throw new Error(`Invalid range tail: "${tail}"`);
    const r2 = toIntOrUndef(tm[1]!);
    const c2 = toIntOrUndef(tm[2]!);
    return { kind: "range", r1, c1, r2, c2 };
  }
}

// -- Resolution --

export function resolveRange(
  spec: RangeSpec,
  rows: number,
  cols: number,
  allowOmitted: boolean,
): Rect {
  if (spec.kind === "range") {
    if (
      !allowOmitted &&
      (spec.r1 === undefined ||
        spec.c1 === undefined ||
        spec.r2 === undefined ||
        spec.c2 === undefined)
    ) {
      throw new Error("Omitted range positions are not allowed for write");
    }
    const r1 = spec.r1 ?? 1;
    const c1 = spec.c1 ?? 1;
    const r2 = spec.r2 ?? rows;
    const c2 = spec.c2 ?? cols;
    return { r1, c1, r2, c2 };
  } else {
    if (
      !allowOmitted &&
      (spec.r1 === undefined ||
        spec.c1 === undefined ||
        spec.h === undefined ||
        spec.w === undefined)
    ) {
      throw new Error("Omitted range positions are not allowed for write");
    }
    const r1 = spec.r1 ?? 1;
    const c1 = spec.c1 ?? 1;
    const h = spec.h ?? rows - r1 + 1;
    const w = spec.w ?? cols - c1 + 1;
    return { r1, c1, r2: r1 + h - 1, c2: c1 + w - 1 };
  }
}

// -- File loading / validation --

function checkPrintableAscii(line: string, lineNumber: number): void {
  for (let j = 0; j < line.length; j++) {
    const code = line.charCodeAt(j);
    if (code < 0x20 || code > 0x7e) {
      throw new Error(
        `Non-printable-ASCII character at line ${lineNumber}, col ${j + 1}: U+${code
          .toString(16)
          .padStart(4, "0")}`,
      );
    }
  }
}

export function parseGrid(
  text: string,
  padShortLines: boolean = false,
): string[] {
  let body = text;
  if (body.endsWith("\n")) body = body.slice(0, -1);
  if (body === "") return [];
  const lines = body.split("\n");
  for (let i = 0; i < lines.length; i++) {
    checkPrintableAscii(lines[i]!, i + 1);
  }
  if (padShortLines) {
    let width = 0;
    for (const line of lines) if (line.length > width) width = line.length;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]!.length < width)
        lines[i] = lines[i]! + " ".repeat(width - lines[i]!.length);
    }
    return lines;
  }
  const width = lines[0]!.length;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.length !== width) {
      throw new Error(
        `File is not rectangular: line ${i + 1} has width ${lines[i]!.length}, expected ${width}`,
      );
    }
  }
  return lines;
}

// -- Read --

export function readSlice(
  lines: string[],
  rect: Rect,
  ignoreMissing: boolean = false,
): string {
  const rows = lines.length;
  const cols = rows > 0 ? lines[0]!.length : 0;
  if (rect.r1 > rect.r2 || rect.c1 > rect.c2) {
    throw new Error(
      `Invalid range ${rect.r1}:${rect.c1}-${rect.r2}:${rect.c2}`,
    );
  }
  let r1 = rect.r1;
  let c1 = rect.c1;
  let r2 = rect.r2;
  let c2 = rect.c2;
  if (ignoreMissing) {
    r1 = Math.max(r1, 1);
    c1 = Math.max(c1, 1);
    r2 = Math.min(r2, rows);
    c2 = Math.min(c2, cols);
    if (r1 > r2 || c1 > c2) return "";
  } else if (r1 < 1 || c1 < 1 || r2 > rows || c2 > cols) {
    throw new Error(
      `Range ${rect.r1}:${rect.c1}-${rect.r2}:${rect.c2} out of bounds for ${rows}x${cols} file`,
    );
  }
  const out: string[] = [];
  for (let r = r1; r <= r2; r++) {
    out.push(lines[r - 1]!.slice(c1 - 1, c2));
  }
  return out.join("\n");
}

// -- Write --

export function tilePattern(
  pattern: string,
  length: number,
  phase: number = 0,
): string {
  if (length <= 0) return "";
  if (pattern.length === 0) throw new Error("tile pattern must be non-empty");
  let out = "";
  for (let i = 0; i < length; i++) {
    out += pattern[(phase + i) % pattern.length];
  }
  return out;
}

export function writeSlice(
  lines: string[],
  rect: Rect,
  content: string,
  fill: string | undefined,
  clip: boolean = false,
): string[] {
  if (rect.r1 < 1 || rect.c1 < 1 || rect.r1 > rect.r2 || rect.c1 > rect.c2) {
    throw new Error(
      `Invalid write range ${rect.r1}:${rect.c1}-${rect.r2}:${rect.c2}`,
    );
  }
  for (let i = 0; i < content.length; i++) {
    const code = content.charCodeAt(i);
    if (code === 0x0a) continue;
    if (code < 0x20 || code > 0x7e) {
      throw new Error(
        `Non-printable-ASCII character in content at offset ${i}: U+${code
          .toString(16)
          .padStart(4, "0")}`,
      );
    }
  }
  if (fill !== undefined) {
    if (fill.length < 1)
      throw new Error(`--fill must be at least one character`);
    for (let i = 0; i < fill.length; i++) {
      const c = fill.charCodeAt(i);
      if (c < 0x20 || c > 0x7e)
        throw new Error(`--fill must contain only printable ASCII characters`);
    }
  }

  const h = rect.r2 - rect.r1 + 1;
  const w = rect.c2 - rect.c1 + 1;
  const contentLines = content === "" ? [] : content.split("\n");

  if (clip) {
    if (contentLines.length > h) contentLines.length = h;
    for (let i = 0; i < contentLines.length; i++) {
      if (contentLines[i]!.length > w) {
        contentLines[i] = contentLines[i]!.slice(0, w);
      }
    }
  }

  if (fill === undefined) {
    if (contentLines.length !== h) {
      throw new Error(
        `Content has ${contentLines.length} lines, expected ${h}`,
      );
    }
    for (let i = 0; i < contentLines.length; i++) {
      if (contentLines[i]!.length !== w) {
        throw new Error(
          `Content line ${i + 1} has width ${contentLines[i]!.length}, expected ${w}`,
        );
      }
    }
  } else {
    if (contentLines.length > h) {
      throw new Error(`Content has ${contentLines.length} lines, max ${h}`);
    }
    for (let i = 0; i < contentLines.length; i++) {
      if (contentLines[i]!.length > w) {
        throw new Error(
          `Content line ${i + 1} has width ${contentLines[i]!.length}, max ${w}`,
        );
      }
    }
    while (contentLines.length < h) contentLines.push("");
    for (let i = 0; i < contentLines.length; i++) {
      const line = contentLines[i]!;
      if (line.length < w) {
        contentLines[i] =
          line + tilePattern(fill, w - line.length, line.length);
      }
    }
  }

  const oldRows = lines.length;
  const oldCols = oldRows > 0 ? lines[0]!.length : 0;
  const newRows = Math.max(oldRows, rect.r2);
  const newCols = Math.max(oldCols, rect.c2);

  const result: string[] = [];
  for (let r = 1; r <= newRows; r++) {
    const oldLine = r <= oldRows ? lines[r - 1]! : "";
    let line = oldLine;
    if (r >= rect.r1 && r <= rect.r2) {
      if (line.length < rect.c1 - 1) {
        throw new Error(
          `Write would leave a gap on row ${r}: cols ${line.length + 1}..${
            rect.c1 - 1
          } undefined`,
        );
      }
      const before = line.slice(0, rect.c1 - 1);
      const after = line.slice(rect.c2);
      line = before + contentLines[r - rect.r1]! + after;
    }
    if (line.length !== newCols) {
      throw new Error(
        `Write would leave row ${r} with width ${line.length}, expected ${newCols} (result would not be rectangular)`,
      );
    }
    result.push(line);
  }
  return result;
}

// -- CLI --

function usage(message?: string): never {
  if (message) console.error(message + "\n");
  console.error(
    [
      "Usage:",
      "  text-grid <file> read [range] [--ignore-missing]",
      "  text-grid <file> write <range> -- <content> [--fill PATTERN] [--clip]",
      "  text-grid <file> write <range> [--fill PATTERN] [--clip] < content",
      "",
      "Range formats:",
      "  l:c-l:c        1-indexed inclusive corners",
      "  l:c-wxh        1-indexed top-left, then width x height",
      "  (i,j)-(i,j)    0-indexed, exclusive end",
      "  (i,j)x(h,w)    0-indexed top-left, then height x width",
      "  Any position may be omitted in read mode (defaults to file min/max).",
      "  Range defaults to ':-:' (whole file) in read mode when omitted.",
      "  --ignore-missing on read is lenient about missing content:",
      "    short lines are padded with spaces to the max line width, and",
      "    ranges that extend past the file are clipped to the file's bounds.",
      "",
      "Write content:",
      "  Content must come after a literal '--' marker, OR be piped via stdin.",
      "  Multiple args after '--' are joined with a single space.",
      "  --fill PATTERN pads under-sized content; the pattern is tiled",
      "    horizontally across each row with its origin at the range's left edge.",
      "  --clip trims over-sized content.",
    ].join("\n"),
  );
  exit(1);
  throw new Error("unreachable");
}

// ArgsParser refuses to consume a next-arg value that starts with '-', so
// `--fill "-- "` would silently drop the value. Rewrite `--fill VALUE` to
// `--fill=VALUE` (up to a bare `--`) so any string value is accepted.
function preprocessArgs(raw: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const a = raw[i]!;
    if (a === "--") {
      out.push(...raw.slice(i));
      break;
    }
    if (a === "--fill" && i + 1 < raw.length && raw[i + 1] !== "--") {
      out.push(`--fill=${raw[i + 1]}`);
      i++;
      continue;
    }
    out.push(a);
  }
  return out;
}

async function main() {
  const parsed = new ArgsParser(preprocessArgs(args()), {
    boolean: ["clip", "ignore-missing"],
  });
  const loose = parsed.getLoose();
  const [file, command, rangeStr, ...rest] = loose;

  if (!file || !command) usage();

  if (command === "read") {
    const ignoreMissing = parsed.getBoolean("ignore-missing");
    const text = readFileSync(file, "utf8");
    const lines = parseGrid(text, ignoreMissing);
    const spec = parseRange(rangeStr ?? ":-:");
    const rect = resolveRange(spec, lines.length, lines[0]?.length ?? 0, true);
    const output = readSlice(lines, rect, ignoreMissing);
    process.stdout.write(output === "" ? "" : output + "\n");
    return;
  }

  if (command === "write") {
    if (!rangeStr) usage("write requires a range");
    if (rest.length > 0) {
      usage(
        `write: content must be passed after '--' or via stdin (got extra positional args: ${JSON.stringify(rest)})`,
      );
    }
    const fill = parsed.get("fill");
    const clip = parsed.getBoolean("clip");
    let content: string | undefined;
    const restCommand = parsed.getRest();
    if (restCommand) {
      content = restCommand;
    } else if (!process.stdin.isTTY) {
      content = readFileSync(0, "utf8");
    } else if (typeof fill === "string") {
      content = "";
    } else {
      usage(
        "write: no content provided (use '--', pipe via stdin, or pass --fill)",
      );
    }
    if (content.endsWith("\n")) content = content.slice(0, -1);
    const text = existsSync(file) ? readFileSync(file, "utf8") : "";
    const lines = parseGrid(text);
    const spec = parseRange(rangeStr);
    const rect = resolveRange(spec, lines.length, lines[0]?.length ?? 0, false);
    const newLines = writeSlice(
      lines,
      rect,
      content,
      typeof fill === "string" ? fill : undefined,
      clip,
    );
    writeFileSync(file, newLines.join("\n") + "\n");
    return;
  }

  usage();
}

if (import.meta.main) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    exit(1);
  });
}
