import type {
  ContentReference,
  ConversationDetail,
  ConversationNode,
} from "./api.ts";

/**
 * Walks the conversation's active branch from current_node up to the root via
 * `parent`, then reverses it. The mapping is a tree with dead regeneration
 * branches; current_node identifies the one path actually shown in the UI.
 */
export function activeMessagePath(
  detail: ConversationDetail,
): ConversationNode["message"][] {
  const path: ConversationNode["message"][] = [];
  let nodeId: string | null = detail.current_node;
  while (nodeId !== null) {
    const node: ConversationNode | undefined = detail.mapping[nodeId];
    if (!node) break;
    if (node.message) path.push(node.message);
    nodeId = node.parent;
  }
  return path.reverse();
}

/**
 * Replaces inline citation placeholders (e.g. `citeturn199664search7...`) with
 * their Markdown link. Only handles "substantial" placeholders (matched_text
 * longer than a single character) — ChatGPT also emits single-space
 * placeholders marking an unrelated "sources" footer, which have nothing to
 * usefully inline and are left as-is.
 */
function applyContentReferences(
  text: string,
  refs: ContentReference[],
): string {
  let result = text;
  for (const ref of refs) {
    if (ref.matched_text.length > 1 && ref.alt) {
      result = result.replaceAll(ref.matched_text, ref.alt);
    }
  }
  return result;
}

function messageText(
  message: NonNullable<ConversationNode["message"]>,
): string {
  if (message.content.content_type !== "text") return "";
  const refs = message.metadata?.content_references;
  return (message.content.parts ?? [])
    .filter((p): p is string => typeof p === "string")
    .map((part) => (refs ? applyContentReferences(part, refs) : part))
    .join("\n");
}

function isoFromUnixSeconds(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

export function toMarkdown(
  id: string,
  detail: ConversationDetail,
  fetchedAt: Date,
): string {
  const frontmatter = [
    "---",
    `id: ${id}`,
    `create_time: ${isoFromUnixSeconds(detail.create_time)}`,
    `update_time: ${isoFromUnixSeconds(detail.update_time)}`,
    `fetched_at: ${fetchedAt.toISOString()}`,
    "---",
    "",
  ];
  const lines = [...frontmatter, `# ${detail.title || "(untitled)"}`, ""];
  for (const message of activeMessagePath(detail)) {
    if (!message) continue;
    if (message.metadata?.is_visually_hidden_from_conversation) continue;
    const role = message.author.role;
    if (role !== "user" && role !== "assistant") continue;
    const text = messageText(message).trim();
    if (!text) continue;
    const timestamp =
      message.create_time !== null
        ? isoFromUnixSeconds(message.create_time)
        : "";
    lines.push(`## ${role}${timestamp ? ` (${timestamp})` : ""}`, "", text, "");
  }
  return lines.join("\n");
}

function slugify(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function timestampPrefix(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}`
  );
}

/**
 * Filenames embed an 8-char id prefix so a cache lookup for a given id can be
 * done by listing the directory and matching filenames — no need to open and
 * parse every file's frontmatter to find the one with a matching id.
 */
export function conversationFilename(
  id: string,
  createTimeSeconds: number,
  title: string,
): string {
  const stamp = timestampPrefix(new Date(createTimeSeconds * 1000));
  const idPrefix = id.slice(0, 8);
  const slug = slugify(title);
  return `${stamp}-${idPrefix}${slug ? `-${slug}` : ""}.md`;
}

/**
 * Same scheme as conversationFilename, but project ids all share a "g-p-"
 * prefix that adds no disambiguating value — stripped before taking the 8-char
 * id slice so the prefix carries real entropy.
 */
export function projectListCacheFilename(
  id: string,
  createTimeIso: string,
  title: string,
): string {
  const stamp = timestampPrefix(new Date(createTimeIso));
  const idPrefix = id.replace(/^g-p-/, "").slice(0, 8);
  const slug = slugify(title);
  return `${stamp}-${idPrefix}${slug ? `-${slug}` : ""}.jsonl`;
}
