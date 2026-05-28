import type { Range, RawAddress } from "./types.ts";

function isProjectStart(s: string) {
  return (
    s === "/" ||
    s === "." ||
    s.startsWith("/") ||
    s.startsWith("./") ||
    s.startsWith("../")
  );
}

export function parseRange(s: string): Range<string> | undefined {
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

export function parseAddress(input: string): RawAddress {
  // Direct .jsonl file: /path/to/chat.jsonl or /path/to/chat.jsonl/msg-id
  const jsonlMatch = input.match(/^(.+\.jsonl)(\/(.+))?$/);
  if (jsonlMatch && jsonlMatch[1]) {
    const [, pathInput, , messagesInput] = jsonlMatch;
    return { pathInput, messagesInput };
  }

  let rest = input;
  let pathInput: string | undefined;

  if (isProjectStart(input)) {
    if (input === "/") return { pathInput: "/" };
    const colonPosition = input.indexOf(":");
    if (colonPosition === -1) return { pathInput: input };
    pathInput = input.slice(0, colonPosition);
    rest = input.slice(colonPosition + 1);
  }

  const slashPosition = rest.indexOf("/");
  if (slashPosition === -1) return { pathInput, chatInput: rest || undefined };

  const chatInput = rest.slice(0, slashPosition);
  const messagesInput = rest.slice(slashPosition + 1) || undefined;
  return { pathInput, chatInput, messagesInput };
}
