export interface ToolConfig {
  workspacePath: string;
  originalImagePath?: string;
  apiKey?: string;
  provider?: "anthropic" | "gemini";
  onChatMessage?: (message: any) => Promise<void>;
}
