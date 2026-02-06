import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { createChildLogger } from "../utils/logger.js";
import type { ToolConfig } from "../types.js";

export function createWriteLatexTool(config: ToolConfig) {
  const log = createChildLogger({ tool: "writeLatex" });
  const texPath = path.join(config.workspacePath, "document.tex");

  return new DynamicStructuredTool({
    name: "write_latex",
    description:
      "Write or overwrite the full content of the LaTeX document file. " +
      "Pass the complete LaTeX source as `content`. " +
      "This replaces the entire file each time — always include the full document, not just a diff.",
    schema: z.object({
      content: z
        .string()
        .describe("The full LaTeX source code to write to the file"),
    }),
    func: async ({ content }) => {
      log.info("Writing LaTeX file", {
        path: texPath,
        contentLength: content.length,
      });

      try {
        await mkdir(path.dirname(texPath), { recursive: true });
        await writeFile(texPath, content, "utf-8");

        const byteCount = Buffer.byteLength(content, "utf-8");
        const lineCount = content.split("\n").length;

        log.info("LaTeX file written successfully", {
          path: texPath,
          bytes: byteCount,
          lines: lineCount,
        });

        return `Wrote ${byteCount} bytes (${lineCount} lines) to ${texPath}`;
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Unknown write error";
        log.error("Failed to write LaTeX file", { path: texPath, error: message });
        return `Error writing LaTeX file: ${message}`;
      }
    },
  });
}
