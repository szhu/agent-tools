import { args, ArgsParser } from "@cross/utils";

const parsed = new ArgsParser(args());
const command = parsed.getLoose()[0];

if (!command) {
  console.error("Usage: (self) <command> [options]");
} else {
  console.log("command:", command);
  console.log("loose args:", parsed.getLoose().slice(1));
}
