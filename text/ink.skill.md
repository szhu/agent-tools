# ink

Render an [Ink](https://github.com/vadimdemedes/ink) component tree to stdout as a one-shot snapshot. Useful for producing aligned ASCII layouts (boxes, columns, tables) without hand-computing column offsets the way `text-grid` requires.

Bun's auto-install handles the dependencies, so no `package.json` entry or `bun add` is needed. Write a `.tsx` file, run it with `bun`, and stdout is the frame.

## Minimal template

```tsx
// /tmp/render.tsx
import { render } from "ink-testing-library";
import { Box, Text } from "ink";

const { lastFrame } = render(
  <Box flexDirection="column">
    <Box>
      <Box width={10}>
        <Text>Alex</Text>
      </Box>
      <Text>Paris → Toronto</Text>
    </Box>
    <Box>
      <Box width={10}>
        <Text>Dad</Text>
      </Box>
      <Text>RV</Text>
    </Box>
  </Box>,
);

console.log(lastFrame());
```

Run:

```sh
bun run /tmp/render.tsx
```

## Why `ink-testing-library`, not `ink`

`ink`'s own `render()` mounts the tree onto the live terminal and stays alive waiting for input. `ink-testing-library`'s `render()` renders synchronously into a buffer and exposes `lastFrame()` as a plain string — exactly what you want for "print once and exit."

## Preserving color when piping

Ink honors `FORCE_COLOR`. When piping the output somewhere that should keep ANSI styling:

```sh
FORCE_COLOR=1 bun run /tmp/render.tsx | tee out.txt
```

Without it, colors are stripped once stdout isn't a TTY.

## Layout tips for aligned diagrams

- Use `<Box width={N}>` for fixed-width columns; children are truncated/padded to fit.
- `<Box flexDirection="column">` stacks rows; the default is a row.
- Use `<Text>` for anything with text. Bare strings inside `<Box>` throw.
- Set `<Text wrap="truncate">` (or `"truncate-end"`, `"truncate-middle"`) to prevent long strings from breaking column alignment.
- For a gantt-style bar chart, use one `<Box>` per row with a fixed-width label column, then a spacer/text column whose contents encode the bar (e.g. `" ".repeat(start) + "=".repeat(length)`).

## When to reach for `text-grid` instead

Ink is the right tool when you're composing a layout from scratch. `text-grid` is the right tool when you're surgically patching a specific rectangle of an existing ASCII file — Ink can't help you overwrite cells 11–20 of row 3 in place.
