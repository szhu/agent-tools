# vcs-recent-history-hook

Claude Code integration for [`vcs-recent-history`](../README.md). Installs three hooks (UserPromptSubmit, PreToolUse, PostToolUse) that surface recent JJ or Git operations to the agent, using a transcript-derived watermark so each fire reports only what's new since the previous one.

The point is attribution: help the agent distinguish VCS operations caused by its own tool calls from operations caused by the user or other external activity. Without this, the agent frequently misreads concurrent user edits as its own tools misbehaving.

This binary is the Claude-Code-specific integration layer; the actual query is delegated to the `vcs-recent-history` subprocess. Same abstraction split as `lint-staged` vs `husky`.

## Install

```
vcs-recent-history-hook --install=claude-code-global [--limit=N]
```

Writes hook entries into `$CLAUDE_CONFIG_DIR/settings.json` (default `~/.claude/settings.json`), one entry per event. `--limit` sets the cap on operations reported per fire (default 3). Re-running install is idempotent -- existing entries with our marker are replaced.

## Uninstall

```
vcs-recent-history-hook --uninstall
```

Removes only entries tagged with the `#vcs-recent-history-hook` marker (see below). Other hooks in the same file are left untouched.

## Hook events

Each of the three hooks fires the same binary; the framing differs based on when in the turn the fire lands:

- **UserPromptSubmit** -- runs when the user submits a new prompt. Notifies the agent of any VCS operations that happened between its previous tool call and this new prompt. These are definitionally not caused by the agent.
- **PreToolUse** -- runs right before the agent's next tool call. Same attribution as UserPromptSubmit: operations reported here happened before the tool ran, so they weren't caused by it.
- **PostToolUse** -- runs after a tool call completes. Reports operations that occurred during the tool call, which likely resulted from it. If the tool call took longer than 300 ms, a disclaimer is appended noting that the operations may include external activity.

## Environment

- **`CLAUDE_CONFIG_DIR`** -- overrides the Claude Code config directory used by install/uninstall. Default: `~/.claude`.

## The `#vcs-recent-history-hook` marker

Each installed hook entry has `#vcs-recent-history-hook` appended to its command string as a trailing shell comment. It's a no-op at runtime (the shell strips comments) but lets install/uninstall reliably target only our entries even if the command string changes across versions (path changes, flag additions, etc.). This is more durable than a sibling JSON field, since Claude Code strips unknown fields on re-save.

## Layout

- `bin/vcs-recent-history-hook` -- shell shim that execs the TypeScript entry point.
- `vcs/recent-history/hook/main.ts` -- entry point; parses stdin, walks the transcript, invokes `vcs-recent-history` as a subprocess, emits output in the correct envelope for the event.
- `vcs/recent-history/hook/input.ts` -- hook input JSON parser.
- `vcs/recent-history/hook/transcript.ts` -- reverse walker over the transcript JSONL, used to find the previous fire's timestamp.
- `vcs/recent-history/hook/index.ts` -- per-session id-to-timestamp index (read/append/rotate).
- `vcs/recent-history/hook/install.ts` -- settings.json install/uninstall using the marker.
- `vcs/recent-history/hook/main.test.ts` -- tests.
