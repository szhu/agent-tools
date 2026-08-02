import { dirname } from "@std/path";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";

interface IndexEntry {
  id: string;
  ts: string;
}

export function readIndex(path: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!existsSync(path)) return map;
  const text = readFileSync(path, "utf8");
  for (const line of text.split("\n")) {
    if (!line) continue;
    const parsed = JSON.parse(line) as IndexEntry;
    map.set(parsed.id, parsed.ts);
  }
  return map;
}

export function appendIndex(
  path: string,
  id: string,
  timestamp: string,
  cap = 100,
): void {
  mkdirSync(dirname(path), { recursive: true });
  const entry: IndexEntry = { id, ts: timestamp };
  appendFileSync(path, JSON.stringify(entry) + "\n");
  // Rotate: if too big, keep last `cap` lines.
  const text = readFileSync(path, "utf8");
  const lines = text.trim().split("\n");
  if (lines.length > cap * 1.5) {
    const trimmed = lines.slice(-cap).join("\n") + "\n";
    writeFileSync(path, trimmed);
  }
}
