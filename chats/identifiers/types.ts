export type Range<T> = {
  start: T;
  startInclusive: boolean;
  end: T;
  endInclusive: boolean;
};

export type RawAddress = {
  // undefined=cwd, '/'=all projects, or absolute/relative path to a project or .jsonl file
  pathInput?: string;

  // undefined=all chats, or a single chat id prefix
  chatInput?: string;

  // undefined=all messages, a single message id prefix, or a range string like [a..=b]
  messagesInput?: string;
};

export type ResolvedAddress =
  | { type: "all" }
  | { type: "project"; projectPath: string; jsonlDir: string }
  | { type: "chat"; projectPath: string; jsonlPath: string; chatId: string }
  | {
      type: "messages";
      projectPath: string;
      jsonlPath: string;
      chatId: string;
      messageId?: string;
      messageIds: Range<string>;
    };
