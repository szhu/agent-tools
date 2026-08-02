# vcs-recent-history

Reports recent JJ or Git operations in the current repo. Designed to be usable both by a person at the terminal and by another tool that wants to notice out-of-band VCS activity between invocations.

The main command knows nothing about Claude Code; the `vcs-recent-history-hook` binary is the Claude-Code-specific integration. This is the same abstraction split as `lint-staged` vs `husky`, where functionality is separated from the integration.

## CLI

```
vcs-recent-history [--vcs=detect|jj|git]
               [--since=<iso-timestamp>]
               [--limit=N]
```

### Behavior

- Detects the VCS by checking for a jj workspace first, then a git repository. If neither is present, the command exits 0 silently. `--vcs=jj` or `--vcs=git` skips detection and errors when the requested VCS is not present. Detection and operations both work from any subdirectory of the repo.
- Reads the op log (jj) or reflog (git) and emits ops with a timestamp strictly greater than the lower bound established by `--since`. If not given, there is no lower bound.
- Caps output at `--limit` ops. If more ops are above the lower bound, a single elision line is printed.
- Prints nothing (exit 0) when there are no ops above the lower bound.

### Flags

- **`--vcs=<detect|jj|git>`** (default `detect`): pick the VCS explicitly. `detect` uses the same rule as above. `jj` or `git` errors if the current working directory is not inside a repo of the requested VCS.
- **`--since=<iso-timestamp>`**: stateless lower bound.
- **`--limit=N`**: cap on emitted ops. Default is infinite.

## Output

When there are ops above the lower bound:

```
Recent JJ ops:
  2026-08-01T14:22:10  d2ae7c44  jj squash --into @-
  2026-08-01T14:21:55  580c84b0  jj new skwysppt
  2026-08-01T14:21:40  e12d39f8  jj describe -m "..."
2 more elided; run `jj op log` to see more.
```

The word "JJ" or "Git" (and correspondingly `jj op log` or `git reflog` in the elision line) is chosen based on which VCS was detected. When there are no elided ops, the elision line is omitted.

The Git equivalent uses `git reflog --date=iso-strict` and each line shows the timestamp, short hash, and subject:

```
Recent Git ops:
  2026-08-01T14:22:10  abc1234  commit: fix off-by-one in range parser
  2026-08-01T14:21:55  def5678  checkout: moving from main to feature-x
  2026-08-01T14:21:40  1234abcd  reset: moving to HEAD~1
2 more elided; run `git reflog` to see more.
```

## See also

- [`vcs/recent-history/hook/README.md`](./hook/README.md) — the Claude Code hook integration (`vcs-recent-history-hook`), which uses this query CLI as a subprocess and derives a per-session watermark from the transcript.

## Layout

- `bin/vcs-recent-history` — shell shim that execs the TypeScript entry point.
- `vcs/recent-history/main.ts` — implementation.
- `vcs/recent-history/main.test.ts` — tests.
