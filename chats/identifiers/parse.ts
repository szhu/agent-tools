import { basename } from "node:path";
import type { Address, Range } from "./types.ts";

const isProjectStart = (s: string) =>
  s === "/" ||
  s === "." ||
  s.startsWith("/") ||
  s.startsWith("./") ||
  s.startsWith("../");

function parseRange(s: string): Range | undefined {
  const m = s.match(/^\[([0-9a-f]+)\.\.(=|<)([0-9a-f]+)\]$/);
  if (!m || !m[1] || !m[3]) return undefined;
  return {
    start: m[1],
    startInclusive: true,
    end: m[3],
    endInclusive: m[2] === "=",
  };
}

export function parseAddress(input: string): Address {
  // Direct .jsonl file: /path/to/chat.jsonl or /path/to/chat.jsonl/msg-id
  const jsonlMatch = input.match(/^(.+\.jsonl)(\/(.+))?$/);
  if (jsonlMatch && jsonlMatch[1]) {
    const filePath = jsonlMatch[1];
    return {
      projectPath: filePath,
      chatId: basename(filePath, ".jsonl"),
      messageId: jsonlMatch[3],
      isJsonlPath: true,
    };
  }

  let rest = input;
  let projectPath: string | undefined;

  if (isProjectStart(input)) {
    if (input === "/") return { projectPath: "/" };
    const colonIdx = input.indexOf(":");
    if (colonIdx === -1) return { projectPath: input };
    projectPath = input.slice(0, colonIdx);
    rest = input.slice(colonIdx + 1);
  }

  const slashIdx = rest.indexOf("/");
  if (slashIdx === -1) return { projectPath, chatId: rest || undefined };

  const chatId = rest.slice(0, slashIdx);
  const msgPart = rest.slice(slashIdx + 1);
  const range = parseRange(msgPart);
  return { projectPath, chatId, messageId: range ? undefined : msgPart, range };
}
