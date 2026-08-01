# vcs-recent-ops

Reports recent JJ or Git operations in the current repo. Designed to be usable both by a person at the terminal and by another tool (currently: a Claude Code hook) that wants to notice out-of-band VCS activity between invocations.

The main command knows nothing about Claude Code; a separate `--install` flag wires it up as a hook. This is the same abstraction split as `lint-staged` vs `husky`, where functionality is separated from the integration.

## CLI

```
vcs-recent-ops [--audience=human|agent-via-hook]
               [--vcs=detect|jj|git]
               [--since=<iso-timestamp>] [--since-file=<path>]
               [--limit=N]
               [--install=claude-code-global]
```

### Behavior

- Detects the VCS by checking for a jj workspace first, then a git repository. If neither is present, the command exits 0 silently. `--vcs=jj` or `--vcs=git` skips detection and errors when the requested VCS is not present. Detection and operations both work from any subdirectory of the repo.
- Reads the op log (jj) or reflog (git) and emits ops with a timestamp strictly greater than the lower bound established by `--since` / `--since-file`. If neither is given, there is no lower bound.
- Caps output at `--limit` ops. If more ops are above the lower bound, a single elision line is printed.
- Prints nothing (exit 0) when there are no ops above the lower bound.

### Flags

- **`--audience`** (default `human`)
  - `human`: currently errors with "not implemented yet." Reserved so that future human-friendly output can be added without changing the default behavior of existing hook installations.
  - `agent-via-hook`: implemented. Emits plain text framed for an agent that may not know about the command and did not run the command itself.
- **`--vcs=<detect|jj|git>`** (default `detect`): pick the VCS explicitly. `detect` uses the same rule as above. `jj` or `git` errors if the current working directory is not inside a repo of the requested VCS.
- **`--since=<iso-timestamp>`**: stateless lower bound.
- **`--since-file=<path>`**: stateful lower bound.
  - If the file does not exist, there is no lower bound. The parent directory is created with `mkdir -p` if missing.
  - If the file exists, its entire contents must be a single ISO-8601 timestamp, optionally surrounded by whitespace. That timestamp is the lower bound.
  - If the file exists but its contents are not a valid timestamp under the above rule, the command fails fast without touching the file:
    ```
    `--since-file=/path/to/file` was passed but the file's contents are not a valid ISO-8601 timestamp. Ensure that the correct file was passed.
    ```
  - The file is only ever overwritten when it did not exist or its contents were a valid timestamp under the above rule. On a successful run that finds new ops, the newest op's timestamp is written.
  - Deleting the file resets state.
- `--since` and `--since-file` are mutually exclusive; passing both is a hard error.
- **`--limit=N`**: cap on emitted ops. Default is infinite. When `--install` is passed, default is 3.
- **`--install=<target>`**: install this command as a hook for the given target. Currently only `claude-code-global` is supported. When passed, `--audience` and `--since-file` are disallowed (they are set implicitly by the installer). `--limit` is still allowed.

## Output

When `--audience=agent-via-hook` and there are ops above the lower bound:

```
Hi, this is `vcs-recent-ops`. JJ ops since the last time this command ran:
  2026-08-01T14:22:10  jj squash --into @-
  2026-08-01T14:21:55  jj new skwysppt
  2026-08-01T14:21:40  jj describe -m "..."
2 more ops elided; run `jj op log` to see more.
```

The word "JJ" or "Git" (and correspondingly `jj op log` or `git reflog` in the elision line) is chosen based on which VCS was detected. When there are no elided ops, the elision line is omitted.

The Git equivalent uses `git reflog --date=iso` and each line shows the timestamp, ref, and action/message:

```
Hi, this is `vcs-recent-ops`. Git ops since the last time this command ran:
  2026-08-01T14:22:10  HEAD@{0}: commit: fix off-by-one in range parser
  2026-08-01T14:21:55  HEAD@{1}: checkout: moving from main to feature-x
  2026-08-01T14:21:40  HEAD@{2}: reset: moving to HEAD~1
2 more ops elided; run `git reflog` to see more.
```

## Installation as a Claude Code hook

```
vcs-recent-ops --install=claude-code-global [--limit=N]
```

This modifies `~/.claude/settings.json` to register the command under the `UserPromptSubmit` and `Stop` hooks. The installed hook command always has an explicit `--limit` (default 3, or whatever was passed to `--install`):

```
/absolute/path/to/bin/vcs-recent-ops \
  --audience=agent-via-hook \
  --since-file="$HOME/.claude/vcs-recent-ops/state/$CLAUDE_SESSION_ID" \
  --limit=3
```

State lives at `~/.claude/vcs-recent-ops/state/<session-id>`, one file per Claude Code session. Deleting the directory resets all sessions.

### Overriding the Claude config location

Both the `--install=claude-code-global` target and the state path it embeds honor Claude Code's standard `CLAUDE_CONFIG_DIR` environment variable. When set, `$CLAUDE_CONFIG_DIR` is used in place of `~/.claude`, so both the settings file being written and the `--since-file` path baked into the installed hook are rooted there. This makes it possible to test `--install` against a scratch directory without touching a real config.

## Layout

- `bin/vcs-recent-ops` — shell shim that execs the TypeScript entry point.
- `vcs/recent-ops/main.ts` — implementation.
- `vcs/recent-ops/main.test.ts` — tests.
