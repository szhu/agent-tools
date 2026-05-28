import { cwd } from "node:process";
import type { Address } from "../identifiers/types.ts";
import type {
  ClaudeCodeChat,
  ClaudeCodeMessage,
} from "../platforms/claudeCode.ts";
import {
  findProjectDir,
  listAllProjects,
  listChats,
  loadChat,
  resolveChat,
  resolveMessage,
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
  } else if (Array.isArray(content) && content.every((item: Record<string, unknown>) => item["type"] === "text" || item["type"] === "thinking")) {
    text = content.map((item: Record<string, unknown>) => String(item["text"] ?? item["thinking"] ?? "")).join("  ").replace(/\n/g, "  ");
  } else {
    const stripped = Array.isArray(content)
      ? content.map((item: Record<string, unknown>) =>
          Object.fromEntries(Object.entries(item).filter((e) => e[0] !== "type")),
        )
      : content;
    text = JSON.stringify(stripped);
  }
  return text;
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

function contentType(message: ClaudeCodeMessage): string {
  const content = message.message?.content;
  if (!content) return "";
  if (typeof content === "string") return "text";
  if (!Array.isArray(content)) return "";
  const types = [...new Set(content.map((item: Record<string, unknown>) => String(item["type"] ?? "")))];
  return types.join("+");
}

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

export async function runLs(addr: Address, sortCol?: string, filterStr?: string): Promise<void> {
  // ls / — list all projects
  if (addr.projectPath === "/") {
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

  // Resolve project dir
  const projectPath = addr.projectPath ?? cwd();
  const projectDir = addr.isJsonlPath
    ? null
    : await findProjectDir(projectPath === "." ? cwd() : projectPath);

  // ls <chat-id>[/msg] — list messages or show one message
  if (addr.chatId) {
    const filePath = addr.isJsonlPath
      ? (addr.projectPath ?? "")
      : projectDir
        ? await listChats(projectDir).then(
            (cs) => resolveChat(cs, addr.chatId!).filePath,
          )
        : (() => {
            throw new Error(`Project not found: ${projectPath}`);
          })();

    const chat = await loadChat(filePath);

    if (addr.messageId) {
      console.log(
        JSON.stringify(resolveMessage(chat.messages, addr.messageId), null, 2),
      );
      return;
    }

    console.log(`${chat.title ?? "(untitled)"}  ${shortId(chat.id)}\n`);
    const messages = chat.messages.filter((m) => m.uuid);
    const filtered = filterStr ? filterRows(messages, messageCols, filterStr) : messages;
    printTable(filtered, messageCols, sortCol);
    return;
  }

  // ls [project] — list chats in project
  if (!projectDir) throw new Error(`Project not found: ${projectPath}`);
  const chats = await listChats(projectDir);
  const filtered = filterStr ? filterRows(chats, chatCols, filterStr) : chats;
  if (filtered.length === 0) {
    console.log("(no chats)");
    return;
  }
  printTable(filtered, chatCols, sortCol);
}
