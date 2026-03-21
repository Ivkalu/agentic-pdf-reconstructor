export interface ToolConfig {
  workspacePath: string;
  originalImagePath?: string;
  apiKey?: string;
  onChatMessage?: (message: any) => Promise<void>;
  onTokenUsage?: (inputTokens: number, outputTokens: number) => Promise<void>;
}
