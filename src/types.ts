export interface ToolConfig {
  workspacePath: string;
  originalImagePath?: string;
  apiKey?: string;
  onChatMessage?: (message: any) => Promise<void>;
  onTokenUsage?: (inputTokens: number, outputTokens: number) => Promise<void>;
  /** Mutable iteration context — updated by the graph before each tool invocation. */
  iterationContext?: { current: number; max: number };
}
