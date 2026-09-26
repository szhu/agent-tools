import { Entry } from "@napi-rs/keyring";
import { stdin, stdout } from "node:process";

export interface Credentials {
  token: string;
  cookie: string;
}

// Automated login (Playwright, both its bundled Chromium and a real Chrome
// profile) gets flagged by bot detection before it can complete. Instead,
// the user runs a snippet in their own already-logged-in browser and pastes
// the result into this CLI once; it's stored in the OS keychain for reuse.

const KEYCHAIN_SERVICE = "agent-tools-chatgpt-export";
const KEYCHAIN_ACCOUNT = "credentials";

function keychainEntry(): Entry {
  return new Entry(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT);
}

function saveCredentials(creds: Credentials): void {
  keychainEntry().setPassword(JSON.stringify(creds));
}

export function loadCredentials(): Credentials | null {
  const raw = keychainEntry().getPassword();
  if (!raw) return null;
  return JSON.parse(raw) as Credentials;
}

const LOGIN_SNIPPET = `copy(JSON.stringify({token:(await fetch('/api/auth/session',{credentials:'include'}).then(r=>r.json())).accessToken,cookie:document.cookie}))`;

/**
 * Reads one line from stdin without echoing it to the terminal, so a pasted
 * credential never appears in scrollback or a recorded terminal session.
 */
async function readMaskedLine(prompt: string): Promise<string> {
  stdout.write(prompt);
  return new Promise((resolve, reject) => {
    const wasRaw = stdin.isRaw;
    stdin.setRawMode?.(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let value = "";
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n") {
          cleanup();
          stdout.write("\n");
          resolve(value);
          return;
        }
        if (char === "\u0003") {
          // Ctrl-C
          cleanup();
          reject(new Error("Aborted"));
          return;
        }
        if (char === "\u007f" || char === "\b") {
          value = value.slice(0, -1);
        } else {
          value += char;
        }
      }
    };
    const cleanup = () => {
      stdin.off("data", onData);
      stdin.setRawMode?.(wasRaw ?? false);
      stdin.pause();
    };
    stdin.on("data", onData);
  });
}

export async function runLogin(): Promise<void> {
  console.log(
    "1. Go to https://chatgpt.com in your browser, make sure you're logged in.",
  );
  console.log("2. Open DevTools (Cmd+Option+I) -> Console tab.");
  console.log(
    "3. Paste and run this snippet (it copies the result to your clipboard):",
  );
  console.log("");
  console.log(`   ${LOGIN_SNIPPET}`);
  console.log("");
  const pasted = await readMaskedLine(
    "4. Paste the copied result here (hidden), then press Enter: ",
  );
  let creds: Credentials;
  try {
    creds = JSON.parse(pasted.trim());
  } catch {
    throw new Error(
      "Could not parse the pasted value as JSON. Did you copy the full snippet output?",
    );
  }
  if (typeof creds.token !== "string" || typeof creds.cookie !== "string") {
    throw new Error("Pasted value is missing 'token' or 'cookie'.");
  }
  saveCredentials(creds);
  console.log("Saved to the system keychain.");
}
