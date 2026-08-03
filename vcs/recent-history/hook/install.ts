import { join } from "@std/path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { HookEvent } from "./input.ts";

export const HOOK_MARKER = "#vcs-recent-history-hook";

interface HookAction {
  type: string;
  command?: string;
}
interface HookEntry {
  matcher?: string;
  hooks: HookAction[];
}
interface Settings {
  hooks?: Record<string, HookEntry[]>;
  [key: string]: unknown;
}

const EVENTS: HookEvent[] = ["UserPromptSubmit", "PreToolUse", "PostToolUse"];

function loadSettings(configDir: string): { path: string; settings: Settings } {
  const path = join(configDir, "settings.json");
  const settings: Settings = existsSync(path)
    ? (JSON.parse(readFileSync(path, "utf8")) as Settings)
    : {};
  return { path, settings };
}

function saveSettings(path: string, settings: Settings): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(settings, null, 2) + "\n");
}

function scrub(settings: Settings): void {
  const hooksByEvent = settings["hooks"] ?? {};
  for (const event of Object.keys(hooksByEvent)) {
    hooksByEvent[event] = (hooksByEvent[event] ?? []).filter((entry) => {
      return !entry?.hooks?.some(
        (action) =>
          typeof action.command === "string" &&
          action.command.includes(HOOK_MARKER),
      );
    });
  }
  settings["hooks"] = hooksByEvent;
}

export function installHooks(opts: {
  configDir: string;
  scriptAbsPath: string;
  limit: number;
}): void {
  const { path, settings } = loadSettings(opts.configDir);
  scrub(settings);
  const command = `${opts.scriptAbsPath} --limit=${opts.limit} ${HOOK_MARKER}`;
  const hooksByEvent = settings["hooks"] ?? {};
  for (const event of EVENTS) {
    const existing = hooksByEvent[event] ?? [];
    existing.push({ hooks: [{ type: "command", command }] });
    hooksByEvent[event] = existing;
  }
  settings["hooks"] = hooksByEvent;
  saveSettings(path, settings);
}

export function uninstallHooks(opts: { configDir: string }): void {
  const { path, settings } = loadSettings(opts.configDir);
  scrub(settings);
  saveSettings(path, settings);
}
