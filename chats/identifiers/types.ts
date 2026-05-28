export type Range = {
  start: string;
  startInclusive: boolean;
  end: string;
  endInclusive: boolean;
};

export type Address = {
  projectPath?: string; // undefined=cwd, '/'=all projects
  chatId?: string; // undefined=all chats
  messageId?: string;
  range?: Range;
  isJsonlPath?: boolean; // projectPath is a direct .jsonl file
};
