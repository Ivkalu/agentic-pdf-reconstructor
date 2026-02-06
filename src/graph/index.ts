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

const log = createChildLogger({ agent: "graph" });

const DEFAULT_MAX_ITERATIONS = 10;

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
    return END;
  }

  if (iterationCount >= maxIterations) {
    log.warn("Max iterations reached, ending workflow", {
      iterationCount,
      maxIterations,
    });
    return END;
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
  return END;
}

// Check after tool execution if done was called
function routeAfterTools(state: GraphStateType): string {
  if (state.isDone) {
    log.info("Done flag set after tool execution, ending");
    return END;
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
}

export function buildGraph(options: BuildGraphOptions) {
  const {
    tools,
    apiKey,
    maxIterations = DEFAULT_MAX_ITERATIONS,
    imageBase64,
    imageMimeType,
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

    // Check if done tool was called in this response
    let doneDetected = false;
    if (
      response instanceof AIMessage &&
      response.tool_calls &&
      response.tool_calls.length > 0
    ) {
      doneDetected = response.tool_calls.some((tc) => tc.name === "done");
      log.debug("Agent response tool calls", {
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

  // Build the graph
  const graph = new StateGraph(GraphState)
    .addNode("agent", agentNode)
    .addNode("tools", toolsNode)
    .addEdge(START, "agent")
    .addConditionalEdges("agent", (state) =>
      routeAfterAgent(state, maxIterations),
    )
    .addConditionalEdges("tools", routeAfterTools)
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

  const finalState = await graph.invoke({
    messages: initialMessages,
    iterationCount: 0,
    isDone: false,
  });

  log.info("Graph execution complete", {
    totalIterations: finalState.iterationCount,
    isDone: finalState.isDone,
    totalMessages: finalState.messages.length,
  });

  return finalState;
}
