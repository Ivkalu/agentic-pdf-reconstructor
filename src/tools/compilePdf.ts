import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { execSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { createChildLogger } from "../utils/logger.js";
import type { ToolConfig } from "../types.js";

function extractLatexErrors(logContent: string): string[] {
  const errors: string[] = [];
  const lines = logContent.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // LaTeX error lines start with "!"
    if (line.startsWith("!")) {
      // Collect the error and a few context lines
      const errorLines = [line];
      for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
        errorLines.push(lines[j]);
        if (lines[j].startsWith("l.")) break; // line reference marks end of error block
      }
      errors.push(errorLines.join("\n"));
    }
  }

  return errors;
}

export function createCompilePdfTool(config: ToolConfig) {
  const log = createChildLogger({ tool: "compilePdf" });
  const texFile = "document.tex";
  const texPath = path.join(config.workspacePath, texFile);
  const pdfPath = path.join(config.workspacePath, "document.pdf");
  const logPath = path.join(config.workspacePath, "document.log");

  return new DynamicStructuredTool({
    name: "compile_pdf",
    description:
      "Compile the current LaTeX document into a PDF using pdflatex. " +
      "Runs pdflatex twice (for references and TOC). " +
      "Returns success/failure status and any compilation errors from the LaTeX log. " +
      "No input is needed — it compiles the file created by write_latex.",
    schema: z.object({}),
    func: async () => {
      log.info("Starting PDF compilation", { texPath });

      const pdflatexCmd = [
        "pdflatex",
        "-interaction=nonstopmode",
        "-halt-on-error",
        `-output-directory=${config.workspacePath}`,
        texPath,
      ].join(" ");

      let lastExitCode = 0;
      let lastStderr = "";

      // Run pdflatex twice for references, TOC, etc.
      for (const pass of [1, 2]) {
        log.info(`pdflatex pass ${pass}/2`, { command: pdflatexCmd });

        try {
          execSync(pdflatexCmd, {
            cwd: config.workspacePath,
            timeout: 60_000,
            stdio: ["pipe", "pipe", "pipe"],
          });
          log.info(`pdflatex pass ${pass} succeeded`);
        } catch (err: unknown) {
          const execErr = err as { status?: number; stderr?: Buffer };
          lastExitCode = execErr.status ?? 1;
          lastStderr = execErr.stderr?.toString("utf-8") ?? "";

          log.warn(`pdflatex pass ${pass} failed`, {
            exitCode: lastExitCode,
          });

          // On first pass failure, still try to read log for errors
          if (pass === 1) break;
        }
      }

      // Read the log file for detailed error info
      let logErrors: string[] = [];
      try {
        const logContent = await readFile(logPath, "utf-8");
        logErrors = extractLatexErrors(logContent);
      } catch {
        // Log file may not exist if pdflatex failed very early
      }

      // Check if PDF was produced
      let pdfSize = 0;
      try {
        const pdfStat = await stat(pdfPath);
        pdfSize = pdfStat.size;
      } catch {
        // PDF does not exist
      }

      if (pdfSize > 0 && lastExitCode === 0) {
        log.info("PDF compilation successful", {
          pdfPath,
          pdfSizeBytes: pdfSize,
        });

        let result = `Compilation successful. PDF written to ${pdfPath} (${pdfSize} bytes).`;
        if (logErrors.length > 0) {
          result += `\n\nWarnings from LaTeX log:\n${logErrors.join("\n---\n")}`;
        }
        return result;
      }

      // Compilation failed
      log.error("PDF compilation failed", {
        exitCode: lastExitCode,
        errorCount: logErrors.length,
      });

      let result = "Compilation FAILED.";
      if (logErrors.length > 0) {
        result += `\n\nLaTeX errors:\n${logErrors.join("\n---\n")}`;
      } else if (lastStderr) {
        result += `\n\nstderr: ${lastStderr.slice(0, 2000)}`;
      } else {
        result += "\n\nNo detailed error information available. Check that the .tex file exists and is valid LaTeX.";
      }

      return result;
    },
  });
}
