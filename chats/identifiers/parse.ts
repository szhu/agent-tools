import { basename } from "node:path";
import type { Address, Range } from "./types.ts";

function isProjectStart(s: string) {
  return (
    s === "/" ||
    s === "." ||
    s.startsWith("/") ||
    s.startsWith("./") ||
    s.startsWith("../")
  );
}

function parseRange(s: string): Range | undefined {
  const match = s.match(/^\[([0-9a-f]+)\.\.(=|<)([0-9a-f]+)\]$/);
  if (!match) return undefined;
  const [, start, inclusivity, end] = match;
  if (!start || !end) return undefined;
  return {
    start,
    startInclusive: true,
    end,
    endInclusive: inclusivity === "=",
  };
}

export function parseAddress(input: string): Address {
  // Direct .jsonl file: /path/to/chat.jsonl or /path/to/chat.jsonl/msg-id
  const jsonlMatch = input.match(/^(.+\.jsonl)(\/(.+))?$/);
  if (jsonlMatch && jsonlMatch[1]) {
    const [, filePath, , messageId] = jsonlMatch;
    return {
      projectPath: filePath,
      chatId: basename(filePath, ".jsonl"),
      messageId,
      isJsonlPath: true,
    };
  }

  let rest = input;
  let projectPath: string | undefined;

  if (isProjectStart(input)) {
    if (input === "/") return { projectPath: "/" };
    const colonPosition = input.indexOf(":");
    if (colonPosition === -1) return { projectPath: input };
    projectPath = input.slice(0, colonPosition);
    rest = input.slice(colonPosition + 1);
  }

  const slashPosition = rest.indexOf("/");
  if (slashPosition === -1) return { projectPath, chatId: rest || undefined };

  const chatId = rest.slice(0, slashPosition);
  const messagePart = rest.slice(slashPosition + 1);
  const range = parseRange(messagePart);
  return {
    projectPath,
    chatId,
    messageId: range ? undefined : messagePart,
    range,
  };
}
