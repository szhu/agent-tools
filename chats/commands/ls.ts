import { cwd } from "node:process";
import type { RawAddress } from "../identifiers/types.ts";
import type {
  ClaudeCodeChat,
  ClaudeCodeMessage,
} from "../platforms/claudeCode.ts";
import {
  listAllProjects,
  listChats,
  loadChat,
  resolveAddress,
} from "../platforms/claudeCode.ts";
import { type Col, filterRows, printTable } from "../tui/table.ts";

function shortId(uuid: string) {
  return uuid.slice(0, 8);
}

function formatDate(ts?: string) {
  if (!ts) return "";
  const date = new Date(ts);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const opts: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: tz,
  };
  const parts = new Intl.DateTimeFormat("en-CA", opts).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")}`;
}

function contentPreview(message: ClaudeCodeMessage): string {
  const content = message.message?.content;
  if (!content) return "";
  let text: string;
  if (typeof content === "string") {
    text = content.replace(/\n/g, "  ");
  } else if (
    Array.isArray(content) &&
    content.every(
      (item: Record<string, unknown>) =>
        item["type"] === "text" || item["type"] === "thinking",
    )
  ) {
    text = content
      .map((item: Record<string, unknown>) =>
        String(item["text"] ?? item["thinking"] ?? ""),
      )
      .join("  ")
      .replace(/\n/g, "  ");
  } else {
    const stripped = Array.isArray(content)
      ? content.map((item: Record<string, unknown>) =>
          Object.fromEntries(
            Object.entries(item).filter((e) => e[0] !== "type"),
          ),
        )
      : content;
    text = JSON.stringify(stripped);
  }
  return text;
}

function contentType(message: ClaudeCodeMessage): string {
  const content = message.message?.content;
  if (!content) return "";
  if (typeof content === "string") return "text";
  if (!Array.isArray(content)) return "";
  const types = [
    ...new Set(
      content.map((item: Record<string, unknown>) =>
        String(item["type"] ?? ""),
      ),
    ),
  ];
  return types.join("+");
}

function firstTs(c: ClaudeCodeChat) {
  return c.messages.find((m) => m.timestamp)?.timestamp ?? "";
}

function lastTs(c: ClaudeCodeChat) {
  return c.messages.findLast((m) => m.timestamp)?.timestamp ?? "";
}

const chatCols: Col<ClaudeCodeChat>[] = [
  { name: "id", value: (c) => c.id, format: (c) => shortId(c.id) },
  { name: "created", value: firstTs, format: (c) => formatDate(firstTs(c)) },
  { name: "modified", value: lastTs, format: (c) => formatDate(lastTs(c)) },
  {
    name: "title",
    value: (c) => c.title ?? "",
    format: (c) => c.title ?? "(untitled)",
  },
];

const messageCols: Col<ClaudeCodeMessage>[] = [
  { name: "id", value: (m) => m.uuid, format: (m) => shortId(m.uuid) },
  {
    name: "date",
    value: (m) => m.timestamp ?? "",
    format: (m) => formatDate(m.timestamp),
  },
  { name: "sender", value: (m) => m.type },
  { name: "type", value: (m) => contentType(m) },
  { name: "content", value: (m) => contentPreview(m) },
];

export async function runLs(
  raw: RawAddress,
  sortCol?: string,
  filterStr?: string,
): Promise<void> {
  const resolved = await resolveAddress(raw, cwd());

  if (resolved.type === "all") {
    const projects = await listAllProjects();
    const rows = await Promise.all(
      projects.map(async (project) => ({
        encoded: project.encoded,
        count: (await listChats(project.dir)).length,
      })),
    );
    printTable(
      rows,
      [
        { name: "project", value: (r) => r.encoded },
        { name: "chats", value: (r) => String(r.count) },
      ],
      sortCol,
    );
    return;
  }

  if (resolved.type === "project") {
    const chats = await listChats(resolved.jsonlDir);
    const filtered = filterStr ? filterRows(chats, chatCols, filterStr) : chats;
    if (filtered.length === 0) {
      console.log("(no chats)");
      return;
    }
    printTable(filtered, chatCols, sortCol);
    return;
  }

  if (resolved.type === "messages") {
    const chat = await loadChat(resolved.jsonlPath);
    const message = chat.messages.find((m) => m.uuid === resolved.messageId);
    console.log(JSON.stringify(message, null, 2));
    return;
  }

  // resolved.type === "chat"
  const chat = await loadChat(resolved.jsonlPath);
  console.log(`${chat.title ?? "(untitled)"}  ${shortId(chat.id)}\n`);
  const messages = chat.messages.filter((m) => m.uuid);
  const filtered = filterStr ? filterRows(messages, messageCols, filterStr) : messages;
  printTable(filtered, messageCols, sortCol);
}
