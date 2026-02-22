import {
  Annotation,
  StateGraph,
  messagesStateReducer,
  START,
  END,
} from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { BaseMessage, AIMessage, SystemMessage, HumanMessage } from "@langchain/core/messages";
import type { DynamicStructuredTool } from "@langchain/core/tools";
import { readFile, writeFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import path from "node:path";
import { createReconstructorModel, SYSTEM_PROMPT } from "../agents/reconstructor.js";
import { translateDocument } from "../agents/translator.js";
import { createChildLogger } from "../utils/logger.js";

const log = createChildLogger({ agent: "graph" });

const DEFAULT_MAX_ITERATIONS = 10;

// Define the graph state with messages, iteration tracking, done flag, and translation fields
export const GraphState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),
  iterationCount: Annotation<number>({
    reducer: (_prev, next) => next,
    default: () => 0,
  }),
  isDone: Annotation<boolean>({
    reducer: (_prev, next) => next,
    default: () => false,
  }),
  targetLanguage: Annotation<string | undefined>({
    reducer: (_prev, next) => next,
    default: () => undefined,
  }),
  translationDone: Annotation<boolean>({
    reducer: (_prev, next) => next,
    default: () => false,
  }),
});

export type GraphStateType = typeof GraphState.State;

// Returns true when translation is requested but not yet performed
function shouldTranslate(state: GraphStateType): boolean {
  return !!(state.targetLanguage && !state.translationDone);
}

// Routing logic after the agent node
function routeAfterAgent(
  state: GraphStateType,
  maxIterations: number,
): string {
  const { messages, iterationCount, isDone } = state;

  if (isDone) {
    log.info("Agent signalled done, ending reconstruction", { iterationCount });
    return shouldTranslate(state) ? "translate" : END;
  }

  if (iterationCount >= maxIterations) {
    log.warn("Max iterations reached, ending workflow", {
      iterationCount,
      maxIterations,
    });
    return shouldTranslate(state) ? "translate" : END;
  }

  const lastMessage = messages[messages.length - 1];

  if (
    lastMessage instanceof AIMessage &&
    lastMessage.tool_calls &&
    lastMessage.tool_calls.length > 0
  ) {
    return "tools";
  }

  // No tool calls — agent finished without calling done
  log.info("Agent produced no tool calls, ending workflow", {
    iterationCount,
  });
  return shouldTranslate(state) ? "translate" : END;
}

// Check after tool execution if done was called
function routeAfterTools(state: GraphStateType): string {
  if (state.isDone) {
    log.info("Done flag set after tool execution, ending reconstruction");
    return shouldTranslate(state) ? "translate" : END;
  }
  return "agent";
}

export interface BuildGraphOptions {
  apiKey: string;
  tools: DynamicStructuredTool[];
  maxIterations?: number;
  systemPrompt?: string;
  imageBase64: string;
  imageMimeType: string;
  provider?: "anthropic" | "gemini";
  targetLanguage?: string;
  workspacePath?: string;
  onChatMessage?: (message: any) => Promise<void>;
}

export function buildGraph(options: BuildGraphOptions) {
  const {
    tools,
    apiKey,
    maxIterations = DEFAULT_MAX_ITERATIONS,
    imageBase64,
    imageMimeType,
    provider,
    targetLanguage,
    workspacePath,
    onChatMessage,
  } = options;

  log.info("Building LangGraph workflow", {
    toolCount: tools.length,
    toolNames: tools.map((t) => t.name),
    maxIterations,
    provider: provider ?? "anthropic",
    targetLanguage: targetLanguage ?? "none",
  });

  const reconstructorModel = createReconstructorModel({ apiKey, tools, provider });

  // Create the tool node
  const toolNode = new ToolNode(tools);

  // Define the agent node
  async function agentNode(
    state: GraphStateType,
  ): Promise<Partial<GraphStateType>> {
    const { messages, iterationCount } = state;
    const newIteration = iterationCount + 1;

    log.info(`Agent iteration ${newIteration}`, {
      iteration: newIteration,
      messageCount: messages.length,
    });

    const response = await reconstructorModel.invoke(messages);

    // Log the agent's text response
    if (response instanceof AIMessage) {
      const textContent = typeof response.content === "string"
        ? response.content
        : Array.isArray(response.content)
          ? response.content
              .filter((c): c is { type: "text"; text: string } => typeof c === "object" && c !== null && "type" in c && c.type === "text")
              .map((c) => c.text)
              .join("\n")
          : "";
      if (textContent) {
        log.info(`Agent message (iteration ${newIteration}):\n${textContent}`);
      }
    }

    // Check if done tool was called in this response
    let doneDetected = false;
    if (
      response instanceof AIMessage &&
      response.tool_calls &&
      response.tool_calls.length > 0
    ) {
      doneDetected = response.tool_calls.some((tc) => tc.name === "done");
      log.info("Agent tool calls", {
        toolCalls: response.tool_calls.map((tc) => tc.name),
        doneDetected,
      });
    }

    return {
      messages: [response],
      iterationCount: newIteration,
      isDone: doneDetected,
    };
  }

  // Define the tools node wrapper to handle state
  async function toolsNode(
    state: GraphStateType,
  ): Promise<Partial<GraphStateType>> {
    log.info("Executing tool calls", {
      iteration: state.iterationCount,
    });

    const result = await toolNode.invoke(state);

    return {
      messages: result.messages,
    };
  }

  // Translation node — runs after reconstruction completes when targetLanguage is set
  async function translationNode(
    state: GraphStateType,
  ): Promise<Partial<GraphStateType>> {
    const lang = state.targetLanguage;

    if (!lang || !workspacePath) {
      log.info("Translation skipped (no target language or workspace path configured)");
      return { translationDone: true };
    }

    log.info("Starting translation phase", { targetLanguage: lang, workspacePath });

    const texPath = path.join(workspacePath, "document.tex");

    try {
      // Read the reconstructed LaTeX
      const latexContent = await readFile(texPath, "utf-8");
      log.info("LaTeX file read for translation", { bytes: latexContent.length });

      // Invoke the translator agent
      const translated = await translateDocument(latexContent, lang, apiKey, provider);
      log.info("LaTeX translated successfully", {
        targetLanguage: lang,
        originalBytes: latexContent.length,
        translatedBytes: translated.length,
      });

      // Write translated LaTeX back to disk
      await writeFile(texPath, translated, "utf-8");
      log.info("Translated LaTeX written to disk", { texPath });

      // Compile the translated document (run pdflatex twice for references/TOC)
      const pdflatexCmd = [
        "pdflatex",
        "-interaction=nonstopmode",
        "-halt-on-error",
        `-output-directory=${workspacePath}`,
        texPath,
      ].join(" ");

      try {
        execSync(pdflatexCmd, { cwd: workspacePath, timeout: 60_000, stdio: "pipe" });
        execSync(pdflatexCmd, { cwd: workspacePath, timeout: 60_000, stdio: "pipe" });
        log.info("Translated PDF compiled successfully");
      } catch (compileErr) {
        log.warn("Translated PDF compilation had errors (document may still be usable)", {
          error: String(compileErr).slice(0, 500),
        });
      }

      if (onChatMessage) {
        await onChatMessage({
          agent: "translator",
          type: "agent_response",
          agentMessage: `Document successfully translated to ${lang} and recompiled.`,
          timestamp: new Date().toISOString(),
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error("Translation phase failed", { error: message });

      if (onChatMessage) {
        await onChatMessage({
          agent: "translator",
          type: "agent_response",
          agentMessage: `Translation to ${lang} encountered an error: ${message}`,
          timestamp: new Date().toISOString(),
        });
      }
    }

    return { translationDone: true };
  }

  // Build the graph
  const graph = new StateGraph(GraphState)
    .addNode("agent", agentNode)
    .addNode("tools", toolsNode)
    .addNode("translate", translationNode)
    .addEdge(START, "agent")
    .addConditionalEdges("agent", (state) =>
      routeAfterAgent(state, maxIterations),
    )
    .addConditionalEdges("tools", routeAfterTools)
    .addEdge("translate", END)
    .compile();

  log.info("LangGraph workflow compiled", {
    translationEnabled: !!targetLanguage,
    targetLanguage: targetLanguage ?? "none",
  });

  return graph;
}

export interface RunGraphOptions extends BuildGraphOptions {
  originalImagePath: string;
}

export async function runGraph(options: RunGraphOptions) {
  const { imageBase64, imageMimeType, targetLanguage } = options;

  const graph = buildGraph(options);

  // Build the initial messages with the system prompt and the image
  const initialMessages: BaseMessage[] = [
    new SystemMessage(SYSTEM_PROMPT),
    new HumanMessage({
      content: [
        {
          type: "text",
          text: "Please reconstruct this document as accurately as possible using LaTeX. Study every detail of the image: layout, fonts, spacing, tables, formulas, colors, headers, footers, and page structure. Write the complete LaTeX source, compile it, verify it against the original, and iterate until the result closely matches.",
        },
        {
          type: "image_url",
          image_url: {
            url: `data:${imageMimeType};base64,${imageBase64}`,
          },
        },
      ],
    }),
  ];

  log.info("Starting graph execution", {
    initialMessageCount: initialMessages.length,
    imageSize: imageBase64.length,
    targetLanguage: targetLanguage ?? "none",
  });

  const finalState = await graph.invoke({
    messages: initialMessages,
    iterationCount: 0,
    isDone: false,
    targetLanguage: targetLanguage,
    translationDone: false,
  });

  log.info("Graph execution complete", {
    totalIterations: finalState.iterationCount,
    isDone: finalState.isDone,
    translationDone: finalState.translationDone,
    totalMessages: finalState.messages.length,
  });

  return finalState;
}
