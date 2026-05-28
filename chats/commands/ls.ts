import { cwd } from "node:process";
import type { Address } from "../identifiers/types.ts";
import {
  findProjectDir,
  listAllProjects,
  listChats,
  loadChat,
  resolveChat,
  resolveMessage,
} from "../platforms/claudeCode.ts";

function shortId(uuid: string) {
  return uuid.slice(0, 8);
}

function shortDate(ts?: string) {
  return ts ? ts.slice(0, 10) : "          ";
}

function contentPreview(msg: {
  message?: { role: string; content: unknown };
}): string {
  const content = msg.message?.content;
  if (!content) return "";
  const text = typeof content === "string" ? content : JSON.stringify(content);
  return text.replace(/\s+/g, " ").slice(0, 80);
}

export async function runLs(addr: Address, sortCol?: string): Promise<void> {
  // ls / — list all projects
  if (addr.projectPath === "/") {
    console.log(
      "project                                                           chats",
    );
    const projects = await listAllProjects();
    for (const { dir, encoded } of projects) {
      const chats = await listChats(dir);
      console.log(`${encoded.padEnd(67)}  ${chats.length}`);
    }
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
      const msg = resolveMessage(chat.messages, addr.messageId);
      console.log(JSON.stringify(msg, null, 2));
      return;
    }

    console.log(`# ${chat.title ?? "(untitled)"}  ${shortId(chat.id)}\n`);
    console.log("id        date        type       content");
    let messages = chat.messages.filter((m) =>
      ["user", "assistant"].includes(m.type),
    );
    if (sortCol === "date")
      messages = messages.sort((a, b) =>
        (a.timestamp ?? "").localeCompare(b.timestamp ?? ""),
      );
    else if (sortCol === "type")
      messages = messages.sort((a, b) => a.type.localeCompare(b.type));
    else if (sortCol === "content")
      messages = messages.sort((a, b) =>
        contentPreview(a).localeCompare(contentPreview(b)),
      );
    for (const msg of messages) {
      console.log(
        `${shortId(msg.uuid)}  ${shortDate(msg.timestamp)}  ${msg.type.padEnd(9)}  ${contentPreview(msg)}`,
      );
    }
    return;
  }

  // ls [project] — list chats in project
  if (!projectDir) throw new Error(`Project not found: ${projectPath}`);
  let chats = await listChats(projectDir);
  if (chats.length === 0) {
    console.log("(no chats)");
    return;
  }
  if (sortCol === "title")
    chats = chats.sort((a, b) => (a.title ?? "").localeCompare(b.title ?? ""));
  else if (sortCol === "id")
    chats = chats.sort((a, b) => a.id.localeCompare(b.id));
  console.log("id        date        title");
  for (const chat of chats) {
    const lastMsg = chat.messages.findLast((m) => m.timestamp);
    console.log(
      `${shortId(chat.id)}  ${shortDate(lastMsg?.timestamp)}  ${chat.title ?? "(untitled)"}`,
    );
  }
}
