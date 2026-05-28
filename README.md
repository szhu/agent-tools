# agent-tools

A centralized repo for translating between formats that agents and humans work with — chat logs, documents, scripts, and conventions — and for managing agent sessions.

## Structure

### `chats/`

Tools and guides for working with Claude Code chat history.

- Scripts interact with `~/.claude/projects/` and build on [claude-code-history-exporter](https://github.com/szhu/claude-code-history-exporter).
- Moving a project moves its chats and VS Code workspace state together.

### `platforms/`

One subdirectory per external platform (e.g. `facebook-messenger/`). Each contains whatever is needed to extract or work with that platform's data — userscripts, parsers, format notes.

### `conventions/`

Documents that tell a human or agent how things are set up and how to work within them. Files are named `<category>-<topic>.md` so related items sort together.

**`environment-global.md`** and **`environment-project.md`** share a parallel structure, with one section per tool category (VCS, linting, etc.). Each section covers:

1. What the preferred setup looks like
2. How to detect whether it's not set up → set it up
3. How to detect whether it's partially set up → optionally improve
4. How to detect whether it's intentionally different → skip this section

`environment-global.md` omits setup instructions (only needs to be done once, out of scope for now).

`style-*.md` files cover how things are written — naming, commits, prose, etc.
