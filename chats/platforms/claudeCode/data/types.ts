export type ClaudeCodeMessage = {
  uuid: string;
  parentUuid: string | null;
  type: string;
  timestamp?: string;
  isSidechain?: boolean;
  message?: { role: string; content: unknown };
  [key: string]: unknown;
};

export type ClaudeCodeChat = {
  id: string;
  filePath: string;
  projectDir: string;
  title?: string;
  messages: ClaudeCodeMessage[];
};
