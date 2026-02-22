import { ChatAnthropic } from "@langchain/anthropic";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { createChildLogger } from "../utils/logger.js";

const log = createChildLogger({ agent: "translator" });

const SYSTEM_PROMPT = `You are an expert LaTeX translator. Translate the text content of a LaTeX document to the requested target language while strictly preserving all LaTeX commands, structure, and formatting.

## Rules

1. **Preserve all LaTeX commands**: Never modify \\documentclass, \\usepackage, \\begin{...}, \\end{...}, \\section, \\textbf, \\frac, math environments ($...$, $$...$$, equation, align, etc.), \\includegraphics, \\label, \\ref, \\cite, etc.

2. **Translate only human-readable text**: Translate prose, headings, captions, list items, table cell content, and descriptive labels. Do not translate filenames, identifiers, or LaTeX option names.

3. **Keep document structure identical**: Maintain the exact same layout, section hierarchy, tables, formulas, figures, and formatting commands.

4. **Add required language support packages**: Insert appropriate LaTeX packages based on the target language. Add them after \\documentclass and before \\begin{document}:
   - Most European languages: ensure \\usepackage[utf8]{inputenc} and \\usepackage[T1]{fontenc} are present, then add \\usepackage[<babel-language>]{babel} (e.g., \\usepackage[german]{babel} for German, \\usepackage[french]{babel} for French, \\usepackage[croatian]{babel} for Croatian, \\usepackage[spanish]{babel} for Spanish).
   - CJK languages (Chinese, Japanese, Korean): add \\usepackage{CJKutf8} and wrap the document body in \\begin{CJK}{UTF8}{<font>}...\\end{CJK} using an appropriate font (min for Japanese, gbsn for Simplified Chinese, bsmi for Traditional Chinese, mj for Korean).
   - Arabic/Hebrew (RTL): add \\usepackage[arabic]{babel} or \\usepackage{arabtex} as appropriate.
   - Russian/Cyrillic: add \\usepackage[russian]{babel} with \\usepackage[utf8]{inputenc} and \\usepackage[T2A]{fontenc}.
   - Do not add duplicate packages if they are already present.

5. **Return the COMPLETE document**: Always return the full LaTeX source from \\documentclass to \\end{document}. Never return a partial document.

6. **Handle special LaTeX characters**: In the translated text, escape any characters that have special meaning in LaTeX: % → \\%, $ → \\$, & → \\&, # → \\#, _ → \\_, ^ → \\^{}, { → \\{, } → \\}. Do not escape these inside LaTeX commands.

7. **Return raw LaTeX only**: Do not wrap the output in markdown code fences (\`\`\`latex...\`\`\`). Return only the raw .tex content.`;

export async function translateDocument(
  latexContent: string,
  targetLanguage: string,
  apiKey: string,
  provider?: "anthropic" | "gemini",
): Promise<string> {
  const resolvedProvider = provider ?? "anthropic";

  log.info("Translator invoked", {
    provider: resolvedProvider,
    targetLanguage,
    latexLength: latexContent.length,
  });

  let model;

  if (resolvedProvider === "gemini") {
    model = new ChatGoogleGenerativeAI({
      model: "gemini-2.0-flash",
      apiKey,
      maxOutputTokens: 8192,
    });
  } else {
    model = new ChatAnthropic({
      model: "claude-sonnet-4-20250514",
      anthropicApiKey: apiKey,
      maxTokens: 8192,
    });
  }

  const response = await model.invoke([
    new SystemMessage(SYSTEM_PROMPT),
    new HumanMessage({
      content:
        `Translate the following LaTeX document to **${targetLanguage}**. ` +
        `Return only the complete translated LaTeX source code — no markdown, no explanations:\n\n${latexContent}`,
    }),
  ]);

  const raw =
    typeof response.content === "string"
      ? response.content
      : response.content
          .filter(
            (block): block is { type: "text"; text: string } =>
              block.type === "text",
          )
          .map((block) => block.text)
          .join("\n");

  // Strip markdown code fences if the model accidentally wrapped the output
  const cleaned = raw
    .replace(/^```(?:latex|tex)?\r?\n?/im, "")
    .replace(/\r?\n?```\s*$/im, "")
    .trim();

  log.info("Translation complete", {
    targetLanguage,
    originalLength: latexContent.length,
    translatedLength: cleaned.length,
  });

  return cleaned;
}
