import { ArgsParser, args, exit } from "@cross/utils";

async function main() {
  const parsed = new ArgsParser(args(), {});
  const install = parsed.get("install");
  const uninstall = parsed.getBoolean("uninstall");

  if (install !== undefined || uninstall) {
    throw new Error("install/uninstall not implemented yet");
  }
  // Default: hook run (fed by stdin JSON). Filled in by later tasks.
  throw new Error("hook run not implemented yet");
}

if (import.meta.main) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    exit(1);
  });
}
