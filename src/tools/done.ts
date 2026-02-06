import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { createChildLogger } from "../utils/logger.js";
import type { ToolConfig } from "../types.js";

export function createDoneTool(_config: ToolConfig) {
  const log = createChildLogger({ tool: "done" });

  return new DynamicStructuredTool({
    name: "done",
    description:
      "Call this tool when you are finished reconstructing the PDF. " +
      "Use it when the analyzer confirms the PDF is a good match, " +
      "or when you are stuck in a loop and cannot make further progress. " +
      "Provide a reason explaining why you are stopping.",
    schema: z.object({
      reason: z
        .string()
        .describe(
          'Why the agent is finishing, e.g. "analyzer confirmed match" or "stuck in loop after 5 iterations"'
        ),
    }),
    func: async ({ reason }) => {
      log.info("Agent signalled DONE", { reason });
      return `__DONE__: ${reason}`;
    },
  });
}
