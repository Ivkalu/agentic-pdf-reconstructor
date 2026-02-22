export interface ToolConfig {
  workspacePath: string;
  originalImagePath?: string;
  apiKey?: string;
  provider?: "anthropic" | "gemini";
  targetLanguage?: string;
  onChatMessage?: (message: any) => Promise<void>;
}
