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
import { createReconstructorModel, SYSTEM_PROMPT } from "../agents/reconstructor.js";
import { createChildLogger } from "../utils/logger.js";
import type { ToolConfig } from "../types.js";

const log = createChildLogger({ agent: "graph" });

const DEFAULT_MAX_ITERATIONS = 25;

export type StopReason = "done_tool" | "max_iterations" | "no_tool_calls" | null;

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

// Define the graph state with messages, iteration tracking, and done flag
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
  stopReason: Annotation<StopReason>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),
  tokenUsage: Annotation<TokenUsage>({
    reducer: (prev, next) => ({
      inputTokens: prev.inputTokens + next.inputTokens,
      outputTokens: prev.outputTokens + next.outputTokens,
    }),
    default: () => ({ inputTokens: 0, outputTokens: 0 }),
  }),
});

export type GraphStateType = typeof GraphState.State;

// Routing logic after the agent node
function routeAfterAgent(
  state: GraphStateType,
  maxIterations: number,
): string {
  const { messages, iterationCount, isDone } = state;

  if (isDone) {
    log.info("Agent signalled done, ending workflow", { iterationCount });
    return "stop";
  }

  if (iterationCount >= maxIterations) {
    log.warn("Max iterations reached, ending workflow", {
      iterationCount,
      maxIterations,
    });
    return "stop";
  }

  const lastMessage = messages[messages.length - 1];

  if (
    lastMessage instanceof AIMessage &&
    lastMessage.tool_calls &&
    lastMessage.tool_calls.length > 0
  ) {
    // Check if the done tool was called
    const hasDoneCall = lastMessage.tool_calls.some(
      (tc) => tc.name === "done",
    );

    if (hasDoneCall) {
      log.info("Done tool detected in tool calls, routing to tools then ending");
    }

    return "tools";
  }

  // No tool calls — agent finished without calling done
  log.info("Agent produced no tool calls, ending workflow", {
    iterationCount,
  });
  return "stop";
}

// Check after tool execution if done was called
function routeAfterTools(state: GraphStateType): string {
  if (state.isDone) {
    log.info("Done flag set after tool execution, ending");
    return "stop";
  }
  return "agent";
}

// Determine the stop reason based on state
function resolveStopReason(state: GraphStateType, maxIterations: number): StopReason {
  if (state.isDone) return "done_tool";

  const lastMessage = state.messages[state.messages.length - 1];
  const hasToolCalls =
    lastMessage instanceof AIMessage &&
    lastMessage.tool_calls &&
    lastMessage.tool_calls.length > 0;

  // If the agent produced no tool calls, that's the primary reason — even if
  // we also happen to be at the iteration limit.
  if (!hasToolCalls) return "no_tool_calls";
  if (state.iterationCount >= maxIterations) return "max_iterations";

  return "max_iterations";
}

export interface BuildGraphOptions {
  apiKey: string;
  tools: DynamicStructuredTool[];
  maxIterations?: number;
  systemPrompt?: string;
  imageBase64: string;
  imageMimeType: string;
  toolConfig?: ToolConfig;
  onChatMessage?: (message: {
    agent: string;
    type: string;
    toolName?: string;
    toolInput?: string;
    toolOutput?: string;
    agentMessage?: string;
    timestamp: string;
  }) => Promise<void>;
}

export function buildGraph(options: BuildGraphOptions) {
  const {
    tools,
    apiKey,
    maxIterations = DEFAULT_MAX_ITERATIONS,
    imageBase64,
    imageMimeType,
    toolConfig,
    onChatMessage,
  } = options;

  log.info("Building LangGraph workflow", {
    toolCount: tools.length,
    toolNames: tools.map((t) => t.name),
    maxIterations,
  });

  const reconstructorModel = createReconstructorModel({ apiKey, tools });

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

    // Extract token usage from response metadata
    const usage = (response as AIMessage).usage_metadata;
    const inputTokens = usage?.input_tokens ?? 0;
    const outputTokens = usage?.output_tokens ?? 0;

    log.info("Token usage for iteration", {
      iteration: newIteration,
      inputTokens,
      outputTokens,
    });

    // Update iteration context so tools can include it in their chat messages
    const toolsCalled =
      response instanceof AIMessage && response.tool_calls
        ? response.tool_calls.map((tc) => tc.name)
        : [];
    if (toolConfig) {
      toolConfig.iterationContext = { current: newIteration, max: maxIterations, toolsCalled };
    }

    // Emit a chat message for text-only iterations (no tool calls) so they're
    // visible in the chat history. Tool-calling iterations are made visible by
    // the tools themselves.
    if (onChatMessage && toolsCalled.length === 0) {
      const textContent =
        response instanceof AIMessage
          ? typeof response.content === "string"
            ? response.content
            : Array.isArray(response.content)
              ? response.content
                  .filter((c): c is { type: "text"; text: string } => typeof c === "object" && c !== null && "type" in c && c.type === "text")
                  .map((c) => c.text)
                  .join("\n")
              : ""
          : "";

      await onChatMessage({
        agent: "reconstructor",
        type: "agent_response",
        agentMessage: `[${newIteration}/${maxIterations}] LLM response (no tool calls)`,
        toolOutput: textContent || undefined,
        timestamp: new Date().toISOString(),
      });
    }

    return {
      messages: [response],
      iterationCount: newIteration,
      isDone: doneDetected,
      tokenUsage: { inputTokens, outputTokens },
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

    // Determine which tools were called in this batch
    const lastAiMsg = [...state.messages].reverse().find((m) => m instanceof AIMessage) as AIMessage | undefined;
    const calledTools = lastAiMsg?.tool_calls?.map((tc) => tc.name) ?? [];
    const hadCompile = calledTools.includes("compile_pdf");
    const hadVerify = calledTools.includes("verify_pdf");

    // Check if compile_pdf succeeded (result message doesn't contain "FAILED")
    let compileSucceeded = false;
    if (hadCompile) {
      for (const msg of result.messages) {
        const content = typeof msg.content === "string" ? msg.content : "";
        if (content.includes("Compilation successful")) {
          compileSucceeded = true;
          break;
        }
      }
    }

    // If compilation succeeded but verify_pdf wasn't called, inject a reminder
    const outMessages = [...result.messages];
    if (compileSucceeded && !hadVerify) {
      log.info("Injecting verify_pdf reminder after successful compilation");
      outMessages.push(
        new HumanMessage(
          "The PDF compiled successfully. You MUST now call verify_pdf to compare it against the original image before making any more changes or calling done.",
        ),
      );
    }

    return {
      messages: outMessages,
    };
  }

  // Terminal node that records why the workflow stopped
  async function stopNode(
    state: GraphStateType,
  ): Promise<Partial<GraphStateType>> {
    const reason = resolveStopReason(state, maxIterations);
    log.info("Workflow stopping", { stopReason: reason, iteration: state.iterationCount });
    return { stopReason: reason };
  }

  // Build the graph
  const graph = new StateGraph(GraphState)
    .addNode("agent", agentNode)
    .addNode("tools", toolsNode)
    .addNode("stop", stopNode)
    .addEdge(START, "agent")
    .addConditionalEdges("agent", (state) =>
      routeAfterAgent(state, maxIterations),
    )
    .addConditionalEdges("tools", routeAfterTools)
    .addEdge("stop", END)
    .compile();

  log.info("LangGraph workflow compiled");

  return graph;
}

export interface RunGraphOptions extends BuildGraphOptions {
  originalImagePath: string;
}

export async function runGraph(options: RunGraphOptions) {
  const { imageBase64, imageMimeType } = options;

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
  });

  const maxIter = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const finalState = await graph.invoke(
    {
      messages: initialMessages,
      iterationCount: 0,
      isDone: false,
    },
    {
      // Each LLM iteration uses ~2-3 graph steps (agent + tools + possibly stop).
      // Set recursionLimit high enough so our own maxIterations check is the
      // controlling limit, not LangGraph's default of 25.
      recursionLimit: maxIter * 3 + 10,
    },
  );

  log.info("Graph execution complete", {
    totalIterations: finalState.iterationCount,
    isDone: finalState.isDone,
    totalMessages: finalState.messages.length,
  });

  return finalState;
}
