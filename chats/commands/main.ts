import { ArgsParser, args, exit } from "@cross/utils";
import { parseAddress } from "../identifiers/parse.ts";
import { runLs } from "./ls.ts";
import { runMv } from "./mv.ts";
import { runRename } from "./rename.ts";

const parsed = new ArgsParser(args());
const [command, ...rest] = parsed.getLoose();

async function main() {
  switch (command) {
    case "ls":
      return runLs(parseAddress(rest[0] ?? "."), parsed.get("sort"));

    case "rename":
      if (!rest[0] || !rest[1])
        throw new Error("Usage: chats rename <chat> <new-title>");
      return runRename(parseAddress(rest[0]), rest[1]);

    case "mv":
      if (!rest[0] || !rest[1]) throw new Error("Usage: chats mv <src> <dest>");
      return runMv(parseAddress(rest[0]), parseAddress(rest[1]));

    default:
      console.error("Usage: chats <ls|rename|mv> [args...]");
      exit(1);
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  exit(1);
});
