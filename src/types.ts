export interface ToolConfig {
  workspacePath: string;
  originalImagePath?: string;
  apiKey?: string;
  onChatMessage?: (message: any) => Promise<void>;
}
