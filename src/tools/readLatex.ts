import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createChildLogger } from "../utils/logger.js";
import type { ToolConfig } from "../types.js";

export function createReadLatexTool(config: ToolConfig) {
  const log = createChildLogger({ tool: "readLatex" });
  const texPath = path.join(config.workspacePath, "document.tex");

  return new DynamicStructuredTool({
    name: "read_latex",
    description:
      "Read the current LaTeX document file and return its contents with line numbers. " +
      "Optionally pass `offset` (0-based line number to start from) and `limit` (number of lines to return) " +
      "to read a specific slice of the file. Without these parameters, the full file is returned.",
    schema: z.object({
      offset: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("0-based line offset to start reading from"),
      limit: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("Maximum number of lines to return"),
    }),
    func: async ({ offset, limit }) => {
      log.info("Reading LaTeX file", { path: texPath, offset, limit });

      try {
        const raw = await readFile(texPath, "utf-8");
        const allLines = raw.split("\n");
        const totalLines = allLines.length;

        const start = offset ?? 0;
        const end = limit !== undefined ? start + limit : totalLines;
        const slice = allLines.slice(start, end);

        log.info("LaTeX file read successfully", {
          path: texPath,
          totalLines,
          requestedOffset: start,
          requestedLimit: limit ?? "all",
          returnedLines: slice.length,
        });

        // Prepend 1-based line numbers (matching cat -n style)
        const numbered = slice
          .map((line, i) => {
            const lineNum = String(start + i + 1).padStart(6, " ");
            return `${lineNum}\t${line}`;
          })
          .join("\n");

        return numbered;
      } catch (err: unknown) {
        if (
          err instanceof Error &&
          "code" in err &&
          (err as NodeJS.ErrnoException).code === "ENOENT"
        ) {
          log.warn("LaTeX file not found", { path: texPath });
          return "No LaTeX file exists yet. Use write_latex to create one first.";
        }

        const message =
          err instanceof Error ? err.message : "Unknown read error";
        log.error("Failed to read LaTeX file", { path: texPath, error: message });
        return `Error reading LaTeX file: ${message}`;
      }
    },
  });
}
