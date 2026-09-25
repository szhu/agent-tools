# Agent notes

- Test: `bun test` (there's no `npm test` script -- run `bun test` directly).
- Some `*.e2e.test.ts` files are opt-in; see the top-of-file comment in each for the env var and auth setup they need.
- Lint/format: `bun run lint`, `bun run format` -- see `package.json` `scripts` for what they do.
