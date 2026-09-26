import type { Credentials } from "./auth.ts";

export interface ConversationSummary {
  id: string;
  title: string;
  update_time: string;
}

export interface ContentReference {
  matched_text: string;
  alt?: string;
}

export interface ConversationNode {
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

export interface ConversationDetail {
  title: string;
  create_time: number;
  update_time: number;
  current_node: string;
  mapping: Record<string, ConversationNode>;
}

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

export async function fetchJson(
  url: string,
  creds: Credentials,
): Promise<unknown> {
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
      console.error(`Rate limited, waiting ${waitSeconds}s before retrying...`);
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

export interface ConversationsPage {
  items: ConversationSummary[];
  total: number;
  offset: number;
  limit: number;
}

/**
 * Fetches exactly one page of the default (no-project) conversation list — no
 * internal pagination. Each invocation of the CLI is meant to do one bounded
 * unit of work; a caller that wants to walk further pages does so across
 * separate invocations, driven by `offset`.
 */
export async function fetchConversationsPage(
  creds: Credentials,
  offset?: number,
  limit?: number,
): Promise<ConversationsPage> {
  const params = new URLSearchParams({ order: "updated" });
  if (offset !== undefined) params.set("offset", String(offset));
  if (limit !== undefined) params.set("limit", String(limit));
  const json = (await fetchJson(
    `https://chatgpt.com/backend-api/conversations?${params}`,
    creds,
  )) as {
    items: { id: string; title: string; update_time: string }[];
    total: number;
    offset: number;
    limit: number;
  };
  return {
    items: json.items.map((it) => ({
      id: it.id,
      title: it.title,
      update_time: it.update_time,
    })),
    total: json.total,
    offset: json.offset,
    limit: json.limit,
  };
}

export async function fetchConversationDetail(
  id: string,
  creds: Credentials,
): Promise<ConversationDetail> {
  return (await fetchJson(
    `https://chatgpt.com/backend-api/conversation/${id}`,
    creds,
  )) as ConversationDetail;
}

export interface CursorPage<T> {
  items: T[];
  cursor: string | null;
}

export interface ProjectSummary {
  id: string;
  title: string;
  create_time: string;
}

/**
 * Projects are a distinct gizmo subtype (id prefix `g-p-`) exposed through this
 * "snorlax" sidebar endpoint. Cursor-paginated only — offset/limit aren't
 * supported here (confirmed: passing offset returns the same page every time
 * rather than erroring).
 */
export async function fetchProjectsPage(
  creds: Credentials,
  cursor?: string,
  limit?: number,
): Promise<CursorPage<ProjectSummary>> {
  const params = new URLSearchParams();
  if (cursor !== undefined) params.set("cursor", cursor);
  if (limit !== undefined) params.set("limit", String(limit));
  const json = (await fetchJson(
    `https://chatgpt.com/backend-api/gizmos/snorlax/sidebar?${params}`,
    creds,
  )) as {
    items: {
      gizmo: { id: string; display: { name: string }; created_at: string };
    }[];
    cursor: string | null;
  };
  return {
    items: json.items.map((it) => ({
      id: it.gizmo.id,
      title: it.gizmo.display.name,
      create_time: it.gizmo.created_at,
    })),
    cursor: json.cursor,
  };
}

/**
 * A project's conversation list, same cursor-only pagination as
 * fetchProjectsPage. Unlike fetchConversationsPage, there's no `total`.
 */
export async function fetchProjectConversationsPage(
  creds: Credentials,
  projectId: string,
  cursor?: string,
  limit?: number,
): Promise<CursorPage<ConversationSummary>> {
  const params = new URLSearchParams();
  if (cursor !== undefined) params.set("cursor", cursor);
  if (limit !== undefined) params.set("limit", String(limit));
  const json = (await fetchJson(
    `https://chatgpt.com/backend-api/gizmos/${projectId}/conversations?${params}`,
    creds,
  )) as {
    items: { id: string; title: string; update_time: string }[];
    cursor: string | null;
  };
  return {
    items: json.items.map((it) => ({
      id: it.id,
      title: it.title,
      update_time: it.update_time,
    })),
    cursor: json.cursor,
  };
}
