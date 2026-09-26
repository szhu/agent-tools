import { ArgsParser, args, exit } from "@cross/utils";
import { Entry } from "@napi-rs/keyring";
import { join } from "@std/path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { stdin, stdout } from "node:process";

// -- Types --

interface ConversationSummary {
  id: string;
  title: string;
  update_time: string;
}

interface ContentReference {
  matched_text: string;
  alt?: string;
}

interface ConversationNode {
  id: string;
  message: {
    author: { role: string };
    create_time: number | null;
    content: { content_type: string; parts?: unknown[] };
    metadata?: {
      is_visually_hidden_from_conversation?: boolean;
      content_references?: ContentReference[];
    };
  } | null;
  parent: string | null;
  children: string[];
}

interface ConversationDetail {
  title: string;
  create_time: number;
  update_time: number;
  current_node: string;
  mapping: Record<string, ConversationNode>;
}

interface State {
  // conversation id -> update_time last exported
  exported: Record<string, string>;
}

interface Credentials {
  token: string;
  cookie: string;
}

// -- Credential storage --
// Automated login (Playwright, both its bundled Chromium and a real Chrome
// profile) gets flagged by bot detection before it can complete. Instead,
// the user runs a snippet in their own already-logged-in browser and pastes
// the result into this CLI once; it's stored in the OS keychain for reuse.

const KEYCHAIN_SERVICE = "agent-tools-chatgpt-export";
const KEYCHAIN_ACCOUNT = "credentials";

function keychainEntry(): Entry {
  return new Entry(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT);
}

function saveCredentials(creds: Credentials): void {
  keychainEntry().setPassword(JSON.stringify(creds));
}

function loadCredentials(): Credentials | null {
  const raw = keychainEntry().getPassword();
  if (!raw) return null;
  return JSON.parse(raw) as Credentials;
}

const LOGIN_SNIPPET = `copy(JSON.stringify({token:(await fetch('/api/auth/session',{credentials:'include'}).then(r=>r.json())).accessToken,cookie:document.cookie}))`;

/**
 * Reads one line from stdin without echoing it to the terminal, so a pasted
 * credential never appears in scrollback or a recorded terminal session.
 */
async function readMaskedLine(prompt: string): Promise<string> {
  stdout.write(prompt);
  return new Promise((resolve, reject) => {
    const wasRaw = stdin.isRaw;
    stdin.setRawMode?.(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let value = "";
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n") {
          cleanup();
          stdout.write("\n");
          resolve(value);
          return;
        }
        if (char === "\u0003") {
          // Ctrl-C
          cleanup();
          reject(new Error("Aborted"));
          return;
        }
        if (char === "\u007f" || char === "\b") {
          value = value.slice(0, -1);
        } else {
          value += char;
        }
      }
    };
    const cleanup = () => {
      stdin.off("data", onData);
      stdin.setRawMode?.(wasRaw ?? false);
      stdin.pause();
    };
    stdin.on("data", onData);
  });
}

async function runLogin(): Promise<void> {
  console.log(
    "1. Go to https://chatgpt.com in your browser, make sure you're logged in.",
  );
  console.log("2. Open DevTools (Cmd+Option+I) -> Console tab.");
  console.log(
    "3. Paste and run this snippet (it copies the result to your clipboard):",
  );
  console.log("");
  console.log(`   ${LOGIN_SNIPPET}`);
  console.log("");
  const pasted = await readMaskedLine(
    "4. Paste the copied result here (hidden), then press Enter: ",
  );
  let creds: Credentials;
  try {
    creds = JSON.parse(pasted.trim());
  } catch {
    throw new Error(
      "Could not parse the pasted value as JSON. Did you copy the full snippet output?",
    );
  }
  if (typeof creds.token !== "string" || typeof creds.cookie !== "string") {
    throw new Error("Pasted value is missing 'token' or 'cookie'.");
  }
  saveCredentials(creds);
  console.log("Saved to the system keychain.");
}

// -- Backend API --
// A plain fetch, no browser: a Bearer token + cookie from an
// already-authenticated session passes Cloudflare's bot check, unlike a
// request with no credentials. If that ever stops holding — HTML challenge
// pages instead of JSON — a browser-resident approach (e.g. userscript)
// would be needed instead.

function authHeaders(creds: Credentials): HeadersInit {
  return {
    Authorization: `Bearer ${creds.token}`,
    Cookie: creds.cookie,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const MAX_RATE_LIMIT_RETRIES = 4;
// Unconditional pacing between requests: ChatGPT's backend API isn't meant
// for bulk scripted access and returns 429s if hit back-to-back across
// hundreds of conversations.
const REQUEST_DELAY_MS = 400;

async function fetchJson(url: string, creds: Credentials): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    await sleep(REQUEST_DELAY_MS);
    const res = await fetch(url, { headers: authHeaders(creds) });
    const text = await res.text();

    if (res.status === 429) {
      if (attempt >= MAX_RATE_LIMIT_RETRIES) {
        throw new Error(
          `${url} was rate limited ${attempt + 1} times in a row; giving up.`,
        );
      }
      const retryAfter = Number(res.headers.get("retry-after"));
      const waitSeconds =
        Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter
          : 5 * 2 ** attempt;
      console.log(`Rate limited, waiting ${waitSeconds}s before retrying...`);
      await sleep(waitSeconds * 1000);
      continue;
    }

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(
        `Expected JSON from ${url} but got ${res.status} ${res.statusText}. ` +
          `This usually means Cloudflare blocked the request (bot check). ` +
          `Response started with: ${text.slice(0, 200)}`,
      );
    }
    if (!res.ok) {
      const detail =
        json && typeof json === "object" && "detail" in json
          ? String(json.detail)
          : text;
      const hint =
        res.status === 401
          ? " Your saved credentials likely expired — run with --login again."
          : "";
      throw new Error(
        `${url} returned ${res.status} ${res.statusText}: ${detail}.${hint}`,
      );
    }
    return json;
  }
}

/**
 * Yields one page of conversation summaries at a time (rather than collecting
 * the full list first) so the caller can start fetching and writing
 * conversations before pagination finishes — with a large history, listing
 * alone can take many requests.
 */
async function* listConversationPages(
  creds: Credentials,
): AsyncGenerator<{ items: ConversationSummary[]; total: number }> {
  const limit = 50;
  let offset = 0;
  for (;;) {
    const json = (await fetchJson(
      `https://chatgpt.com/backend-api/conversations?offset=${offset}&limit=${limit}&order=updated`,
      creds,
    )) as {
      items: { id: string; title: string; update_time: string }[];
      total: number;
    };
    const items = json.items.map((it) => ({
      id: it.id,
      title: it.title,
      update_time: it.update_time,
    }));
    yield { items, total: json.total };
    offset += limit;
    if (offset >= json.total) break;
  }
}

async function fetchConversationDetail(
  id: string,
  creds: Credentials,
): Promise<ConversationDetail> {
  return (await fetchJson(
    `https://chatgpt.com/backend-api/conversation/${id}`,
    creds,
  )) as ConversationDetail;
}

// -- Conversation -> Markdown --

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

export function toMarkdown(id: string, detail: ConversationDetail): string {
  const frontmatter = [
    "---",
    `id: ${id}`,
    `create_time: ${isoFromUnixSeconds(detail.create_time)}`,
    `update_time: ${isoFromUnixSeconds(detail.update_time)}`,
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

function safeFilename(createTimeSeconds: number, title: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  const date = new Date(createTimeSeconds * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp =
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}`;
  return `${stamp}${slug ? `-${slug}` : ""}.md`;
}

// -- State --

async function loadState(statePath: string): Promise<State> {
  try {
    return JSON.parse(await readFile(statePath, "utf-8"));
  } catch {
    return { exported: {} };
  }
}

async function saveState(statePath: string, state: State): Promise<void> {
  await writeFile(statePath, JSON.stringify(state, null, 2));
}

// -- CLI --

async function runExport(outDir: string): Promise<void> {
  const creds = loadCredentials();
  if (!creds) {
    throw new Error("No saved credentials. Run with --login first.");
  }

  await mkdir(outDir, { recursive: true });
  const statePath = join(outDir, ".chatgpt-export-state.json");
  const state = await loadState(statePath);

  let seen = 0;
  let written = 0;
  let total = 0;
  for await (const page of listConversationPages(creds)) {
    total = page.total;
    seen += page.items.length;
    console.log(`Listed ${seen}/${total} conversation(s)...`);
    for (const summary of page.items) {
      if (state.exported[summary.id] === summary.update_time) continue;
      written++;
      console.log(`  [${written}] ${summary.title || "(untitled)"}`);
      const detail = await fetchConversationDetail(summary.id, creds);
      const markdown = toMarkdown(summary.id, detail);
      await writeFile(
        join(outDir, safeFilename(detail.create_time, summary.title)),
        markdown,
      );
      state.exported[summary.id] = summary.update_time;
      await saveState(statePath, state);
    }
  }
  console.log(
    `Wrote ${written} conversation(s) to ${outDir} (${total} total, ${total - written} already up to date).`,
  );
}

async function main() {
  const parsed = new ArgsParser(args());

  if (parsed.getBoolean("login")) {
    return runLogin();
  }

  const outDir = parsed.get("out");
  if (typeof outDir !== "string") {
    console.error("Usage: chatgpt-export --login | --out <dir>");
    exit(1);
    return;
  }
  return runExport(outDir);
}

if (import.meta.main) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    exit(1);
  });
}
