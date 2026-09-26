# chatgpt-access

A CLI for pulling and locally caching your own ChatGPT conversations and projects. Login is a one-time paste of a token grabbed from an already-logged-in browser session, since ChatGPT doesn't offer a login flow for scripts.

## CLI

```
chatgpt-access login
chatgpt-access list-projects [--cursor=<cursor>] [--limit=N]
                [--cache-dir=<dir>] [--cache-max-age=<duration>]
chatgpt-access list-conversations [--offset=N] [--limit=N]
                     [--project=<id>] [--cursor=<cursor>]
                     [--cache-dir=<dir>] [--cache-max-age=<duration>]
chatgpt-access get-conversation <id>
                    [--cache-dir=<dir>] [--cache-max-age=<duration>]
```

Each invocation fetches one page; walking further pages is driven by passing back the `offset`/`cursor` from the previous call's output. `list-conversations --project` switches from `--offset` to `--cursor` pagination, and requires having run `list-projects --cache-dir` at least once so the project id resolves to a cache file.

## Caching

`list-conversations` and `get-conversation` both accept `--cache-dir=<dir>` and `--cache-max-age=<duration>` (or `CHATGPT_ACCESS_CACHE_DIR`/`CHATGPT_ACCESS_CACHE_MAX_AGE`) to read/write a local cache and skip refetching within the given age.

Layout under `--cache-dir`:

```
<cache-dir>/
  conversations/   # one Markdown file per get-conversation
  projects/        # one NDJSON file per list-conversations bucket, plus index.jsonl
```

Conversation files are the same Markdown printed to stdout, so the cache dir doubles as a browsable export directory.

## Layout

- `bin/chatgpt-access` — shell shim that execs the TypeScript entry point.
- `chats/platforms/chatgpt/main.ts` — CLI entry point and argument handling.
- `chats/platforms/chatgpt/auth.ts` — keychain-backed credential storage and the login flow.
- `chats/platforms/chatgpt/api.ts` — fetches conversations and projects from ChatGPT.
- `chats/platforms/chatgpt/markdown.ts` — conversation-to-Markdown rendering and cache filenames.
- `chats/platforms/chatgpt/cache.ts` — on-disk cache read/write.
- `chats/platforms/chatgpt/*.test.ts` — unit tests; `main.e2e.test.ts` is opt-in against a real account (see its top-of-file comment).
